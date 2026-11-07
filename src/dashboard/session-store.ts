import { Store, type SessionData } from "express-session";
import type Database from "better-sqlite3";
import type { Statement } from "better-sqlite3";
import type { Request } from "express";
import { DbFile } from "../store/sqlite.ts";
import { sessionDb } from "../store/session-db.ts";
import * as secrets from "../store/secrets.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { messageOf } from "../rules/error-kind.ts";

// express-session의 기본 MemoryStore 대체:
// 다시 시작할 때 세션 소실(로그인 풀림)과 메모리 누수 경고를 SQLite 영속화로 해소.
// 파일은 로그인 세션 DB(database/sessions.db, store/session-db). 다른 DB 와 함께 열린다.
//
// 끝난 세션을 다시 쓰지 않는다. express-session은 요청이 끝날 때 그 요청이 읽은 세션을 저장하므로, 로그아웃, 다른 기기 로그아웃 뒤에
// 그 세션으로 걸려 있던 요청이 끝나면 삭제한 행을 다시 넣는다(set이 upsert). 그래서 끝낸 로그인 세션을 그 절대 기한까지 기억하고(묘비)
// 그 sid는 쓰지 않으며, 만료한 행은 정리 전이어도 늘리지 않는다. 로그인한 세션은 로그인 시각에서 SESSION_MAX_MS를 넘지 못한다(절대 수명).
// 세션이 끝나면 듣는 쪽(onEnded)에 알린다(열린 스트림을 끊는다).
// 삭제에 실패해도(디스크가 가득 참 등) 차단하는 쪽(fail-closed)으로 처리한다: 묘비를 남겨 이 실행에서는 그 세션을 받지 않고, 삭제하지 못한 행은 다시 삭제한다.
// 묘비는 메모리뿐이라 삭제하지 못한 채 다시 시작하면 그 로그인이 되살아난다. 그래서 실패는 부른 쪽에 넘기고(화면이 알린다) 끝(finish)에 남은 수를 남긴다

// maxAge 미설정 쿠키(브라우저 세션 쿠키)의 서버측 보관 기한 폴백
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 로그인한 세션의 절대 수명. 로그인 시각에서 이만큼이 지나면 쓰고 있어도 끝난다(NIST SP 800-63B-4 AAL1 30일) */
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** 삭제하지 못한 행을 다시 삭제하는 간격 */
const RETRY_MS = 60_000;

type Done = (err?: unknown) => void;
type Ended = (sid: string) => void;
// 부른 쪽이 결과를 기다리지 않을 때. 실패는 여기서 남긴다
const unheard =
  (what: string): Done =>
  (err) => {
    if (err) log.error(`로그인 세션 ${what} 실패: ${messageOf(err)}`);
  };

/** 로그인한 세션의 절대 기한. 로그인했는데 로그인 시각이 없으면 이미 지난 것(0). 로그인 전 세션은 기한 없음(null) */
function deadlineOf(session: Partial<SessionData> | null | undefined): number | null {
  if (!session?.user) return null;
  return typeof session.loginAt === "number" ? session.loginAt + SESSION_MAX_MS : 0;
}

class SqliteSessionStore extends Store {
  db: Database.Database;
  _getStmt: Statement<[string], { data: string; expires_at: number }>;
  _setStmt: Statement<[string, string, number, number]>;
  _touchStmt: Statement<[number, string, number]>;
  _deleteStmt: Statement<[string], { data: string }>;
  _pruneStmt: Statement<[number], { sid: string; data: string }>;
  _pruneTimer: NodeJS.Timeout;
  // dbPath 로 따로 연 파일(테스트). 닫을 때 같이 닫는다
  _own: DbFile | null = null;
  /** 끝낸 로그인 세션의 sid → 그 절대 기한. 그때까지 쓰지 않는다 */
  _ended = new Map<string, number>();
  _listeners = new Set<Ended>();
  /** 끝냈지만 삭제하지 못한 sid → 그 사용자 id(모르면 null). 다시 삭제한다 */
  _unsaved = new Map<string, string | null>();
  _retryTimer: NodeJS.Timeout | null = null;
  /** 새 세션을 요청에 단다. express-session이 세션 미들웨어를 만들 때 이 저장소에 붙인다 */
  declare generate: (req: Request) => void;

  // dbPath 는 테스트용(임시 DB, 운영 DB 를 건드리지 않는다). 없으면 함께 연 로그인 세션 DB
  constructor({ dbPath, pruneIntervalMs = 60 * 60 * 1000 }: { dbPath?: string; pruneIntervalMs?: number } = {}) {
    super();
    if (dbPath) {
      this._own = new DbFile(sessionDb.spec);
      this._own.open(dbPath);
    }
    this.db = (this._own ?? sessionDb).get();

    this._getStmt = this.db.prepare("SELECT data, expires_at FROM sessions WHERE sid = ?");
    // 만료한 행(정리 전)은 늘리지 않는다: 있는 행이 만료했으면 바꾸지 않는다(changes 0)
    this._setStmt = this.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at WHERE sessions.expires_at > ?");
    this._touchStmt = this.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ? AND expires_at > ?");
    this._deleteStmt = this.db.prepare("DELETE FROM sessions WHERE sid = ? RETURNING data");
    this._pruneStmt = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ? RETURNING sid, data");

    this._normalize();
    this.prune(); // 기동 시 1회 + 주기 정리
    this._pruneTimer = setInterval(() => {
      try {
        this.prune();
      } catch (error) {
        // 다음 주기에 다시 한다. 서비스에 영향 없음
        log.debug(`만료된 로그인 세션 정리 실패: ${messageOf(error)}`);
      }
    }, pruneIntervalMs);
    this._pruneTimer.unref();
    live.add(this);
  }

  /** 세션이 끝나면(삭제, 정리, 절대 수명) 부른다. 해제 함수를 돌려준다 */
  onEnded(fn: Ended) {
    this._listeners.add(fn);
    return () => void this._listeners.delete(fn);
  }

  // 듣는 쪽마다 따로 부른다(하나가 던져도 삭제가 실패로 돌아가지 않고 다른 쪽도 듣는다)
  _announce(sids: string[]) {
    for (const sid of sids) {
      for (const fn of this._listeners) {
        try {
          fn(sid);
        } catch (error) {
          log.warn(`로그인 세션 끝 알림 처리 실패: ${messageOf(error)}`);
        }
      }
    }
  }

  /** 끝낸 sid인가(묘비가 아직 있다) */
  isEnded(sid: string, now = Date.now()) {
    const until = this._ended.get(sid);
    return until !== undefined && until > now;
  }

  // 삭제한 행의 내용으로 묘비를 남긴다. 로그인한 세션만, 그 절대 기한까지(그 뒤에는 저장해도 이미 만료라 다시 쓰이지 않는다).
  // 읽을 수 없는 내용이면 넉넉히 지금부터 절대 수명만큼
  _bury(sid: string, data: string | null, now = Date.now()) {
    let deadline: number | null;
    try {
      deadline = data === null ? now + SESSION_MAX_MS : deadlineOf(JSON.parse(data) as SessionData);
    } catch {
      deadline = now + SESSION_MAX_MS;
    }
    if (deadline !== null && deadline > now) this._ended.set(sid, deadline);
  }

  // 행을 삭제하고 묘비를 남긴다. 알림은 부르는 쪽이 콜백 뒤에
  _end(sid: string) {
    const row = this._deleteStmt.get(sid);
    if (row) this._bury(sid, row.data);
  }

  // 끝낸다. 삭제가 실패해도 묘비를 남기고(지금부터 절대 수명만큼) 삭제하지 못한 것으로 둔다. 알림은 부르는 쪽이 콜백 뒤에
  _endOrBury(sid: string, userId: string | null) {
    try {
      this._end(sid);
      this._unsaved.delete(sid);
    } catch (error) {
      this._bury(sid, null);
      this._unsaved.set(sid, userId);
      this._armRetry();
      log.error(`끊은 로그인 세션 삭제 실패(이 실행에서는 받지 않으며 다시 삭제 시도): ${messageOf(error)}`);
      throw error;
    }
  }

  _armRetry() {
    if (this._retryTimer) return;
    this._retryTimer = setInterval(() => this.retryUnsaved(), RETRY_MS);
    this._retryTimer.unref();
  }

  /** 삭제하지 못한 행을 다시 삭제한다. 남은 수 */
  retryUnsaved() {
    for (const sid of [...this._unsaved.keys()]) {
      try {
        this._deleteStmt.get(sid);
        this._unsaved.delete(sid);
      } catch (error) {
        log.debug(`끊은 로그인 세션 다시 삭제 실패: ${messageOf(error)}`);
      }
    }
    if (!this._unsaved.size && this._retryTimer) {
      clearInterval(this._retryTimer);
      this._retryTimer = null;
    }
    return this._unsaved.size;
  }

  /** 끊었지만 아직 삭제하지 못한 sid인가 */
  isUnsaved(sid: string) {
    return this._unsaved.has(sid);
  }

  /** 그 사용자의, 끊었지만 아직 삭제하지 못한 sid들 */
  unsavedOf(userId: string) {
    return [...this._unsaved].filter(([, user]) => user === userId).map(([sid]) => sid);
  }

  /** 세션 하나를 끝낸다(다른 기기 로그아웃). 삭제했으면 true. 삭제하지 못했어도 이 실행에서는 끝난 것이고 다시 삭제한다 */
  end(sid: string, userId: string): boolean {
    let ok = true;
    try {
      this._endOrBury(sid, userId);
    } catch {
      ok = false;
    }
    this._announce([sid]);
    return ok;
  }

  /** 종료 순서에서: 삭제하지 못한 행을 마지막으로 다시 삭제한다. 남은 수(다시 시작하면 그 로그인들이 되살아난다) */
  finish() {
    const left = this.retryUnsaved();
    if (left) log.error(`끊은 로그인 세션 ${left}개를 저장소에서 삭제하지 못한 채 종료합니다. 다시 시작하면 그 로그인이 되살아나니 저장 공간을 확인하고, 되살아난 기기는 다른 기기 로그아웃으로 끊으세요`);
    return left;
  }

  /** 저장소의 만료 시각: 쿠키 만료(없으면 폴백), 로그인한 세션이면 그 절대 기한까지 */
  _expiresAt(session: SessionData, now = Date.now()) {
    const expires = session?.cookie?.expires;
    const ts = expires ? new Date(expires).getTime() : NaN;
    const cookie = Number.isFinite(ts) ? ts : now + FALLBACK_TTL_MS;
    const deadline = deadlineOf(session);
    return deadline === null ? cookie : Math.min(cookie, deadline);
  }

  // 이 규칙 전에 쓴 행: 만료를 절대 기한으로 줄이고 넘은 것은 삭제한다(기동 시 한 번. 걸린 요청이 없으니 알리지 않는다)
  _normalize(now = Date.now()) {
    const rows = this.db.prepare("SELECT sid, data, expires_at FROM sessions WHERE expires_at > ?").all(now) as Array<{ sid: string; data: string; expires_at: number }>;
    const shorten = this.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?");
    this.db.transaction(() => {
      for (const { sid, data, expires_at } of rows) {
        let deadline: number | null;
        try {
          deadline = deadlineOf(JSON.parse(data) as SessionData);
        } catch {
          continue; // 읽을 수 없는 행은 읽을 때 삭제한다(_parse)
        }
        if (deadline !== null && deadline < expires_at) shorten.run(deadline, sid);
      }
    })();
  }

  /** 살아 있는 세션(끝내지 않음, 만료 전, 절대 기한 안). 없으면 null. 넘은 것은 삭제하고 알린다. DB 오류는 던진다(스트림의 확인이 콜백 없이 부른다) */
  liveSession(sid: string): SessionData | null {
    if (this.isEnded(sid)) return null;
    const ended: string[] = [];
    const row = this._getStmt.get(sid);
    const found = row && row.expires_at > Date.now() ? this._parse(sid, row.data, ended) : null;
    this._announce(ended);
    return found;
  }

  // express-session Store 계약: 콜백 (err, session|null). better-sqlite3는 동기라 즉시 호출. 콜백은 try 밖에서 한 번
  get(sid: string, cb: (err: unknown, session?: SessionData | null) => void) {
    let found: SessionData | null = null;
    const ended: string[] = [];
    if (this.isEnded(sid)) return cb(null, null);
    try {
      const row = this._getStmt.get(sid);
      if (row && row.expires_at > Date.now()) found = this._parse(sid, row.data, ended);
    } catch (e) {
      return cb(e);
    }
    cb(null, found);
    this._announce(ended);
  }

  // 읽을 수 없는 행은 없는 세션으로 보고 삭제한다. 오류로 넘기면 그 쿠키의 요청이 쿠키가 끝날 때까지 모두 500이 된다.
  // 절대 기한을 넘은 로그인 세션(이 규칙 전에 쓴 행)도 삭제하고 없는 세션으로 답한다. express-session이 빈 새 세션을 만든다
  _parse(sid: string, data: string, ended: string[] = []): SessionData | null {
    let session: SessionData;
    try {
      session = JSON.parse(data);
    } catch (error) {
      this._end(sid);
      ended.push(sid);
      log.warn(`손상된 로그인 세션 1개를 삭제했습니다(해당 사용자는 재로그인이 필요합니다): ${messageOf(error)}`);
      return null;
    }
    const deadline = deadlineOf(session);
    if (deadline !== null && deadline <= Date.now()) {
      this._end(sid);
      ended.push(sid);
      return null;
    }
    return session;
  }

  set(sid: string, session: SessionData, cb: Done = unheard("저장")) {
    const ended: string[] = [];
    try {
      const now = Date.now();
      const expiresAt = this._expiresAt(session, now);
      if (this.isEnded(sid, now)) {
        // 끝낸 세션으로 걸려 있던 요청의 저장. 쓰지 않는다
      } else if (expiresAt <= now) {
        // 절대 기한, 쿠키가 지났다. 있는 행도 끝낸다
        this._end(sid);
        ended.push(sid);
      } else if (this._setStmt.run(sid, JSON.stringify(session), expiresAt, now).changes === 0) {
        // 있는 행이 이미 만료했다(정리 전). 늘리지 않고 끝낸다
        this._end(sid);
        ended.push(sid);
      }
    } catch (e) {
      return cb(e);
    }
    cb(null);
    this._announce(ended);
  }

  // rolling/유휴 갱신. 데이터 재직렬화 없이 만료만 연장. 만료한 행, 끝낸 세션은 늘리지 않는다
  override touch(sid: string, session: SessionData, cb: Done = unheard("만료 연장")) {
    const ended: string[] = [];
    try {
      const now = Date.now();
      const expiresAt = this._expiresAt(session, now);
      if (expiresAt <= now) {
        this._end(sid);
        ended.push(sid);
      } else if (!this.isEnded(sid, now)) {
        this._touchStmt.run(expiresAt, sid, now);
      }
    } catch (e) {
      return cb(e);
    }
    cb(null);
    this._announce(ended);
  }

  // 실패해도 이 실행에서는 끝난 것이라 알린다(성공과 같은 순서로 콜백 다음에)
  destroy(sid: string, cb: Done = unheard("삭제"), userId: string | null = null) {
    let failed: unknown = null;
    try {
      this._endOrBury(sid, userId);
    } catch (e) {
      failed = e;
    }
    cb(failed);
    this._announce([sid]);
  }

  // express-session의 다시 로그인(옛 sid를 삭제하고 새 세션 생성). 삭제하지 못한 세션에 사용자 ID를 남기려고 오버라이드한다
  override regenerate(req: Request, fn: Done) {
    this.destroy(
      req.sessionID,
      (err) => {
        this.generate(req);
        fn(err);
      },
      req.session?.user?.id ?? null,
    );
  }

  /** 그 사용자의 살아 있는 세션들(세션 id, 내용). 내용을 행마다 읽어 필터링한다(사용자 열은 따로 두지 않는다. 세션은 많아야 수십 개). 절대 기한을 넘은 것은 뺀다 */
  sessionsOf(userId: string, now = Date.now()): Array<{ sid: string; session: SessionData }> {
    const rows = this.db.prepare("SELECT sid, data FROM sessions WHERE expires_at > ?").all(now) as Array<{ sid: string; data: string }>;
    return rows.flatMap(({ sid, data }) => {
      try {
        if (this.isEnded(sid, now)) return [];
        const session = JSON.parse(data) as SessionData;
        const deadline = deadlineOf(session);
        return session.user?.id === userId && (deadline === null || deadline > now) ? [{ sid, session }] : [];
      } catch {
        return [];
      }
    });
  }

  /** 만료한 행을 삭제한다. 삭제한 수. 로그인한 세션은 묘비를 남기고 끝났음을 알린다. 지난 묘비도 버린다 */
  prune(now = Date.now()) {
    if (this._unsaved.size) this.retryUnsaved();
    const gone = this._pruneStmt.all(now);
    for (const { sid, data } of gone) this._bury(sid, data, now);
    for (const [sid, until] of this._ended) if (until <= now) this._ended.delete(sid);
    this._announce(gone.map(({ sid }) => sid));
    return gone.length;
  }

  close() {
    clearInterval(this._pruneTimer);
    if (this._retryTimer) clearInterval(this._retryTimer);
    live.delete(this);
    this._own?.close();
  }

  // ── 디스코드 접근 토큰 ──
  // 로그인 때 받은 토큰을 세션 행에 암호문으로 둔다(세션 JSON 밖, 세션 ID 에 묶음). 세션 행과 함께 삭제된다.
  // 세션을 저장(set)해도 이 열은 그대로다

  /** 그 세션 행에 토큰을 적는다. 행이 없으면(아직 저장 전) false */
  saveDiscordToken(sid: string, token: string) {
    return this.db.prepare("UPDATE sessions SET discord_token = ? WHERE sid = ?").run(secrets.sealBlob(TOKEN_PURPOSE, token, sid), sid).changes > 0;
  }

  /** 토큰. 없거나 복호화되지 않으면(다른 SECRETS_KEY, 다른 행에서 옮김) null */
  readDiscordToken(sid: string) {
    const blob = this.db.prepare("SELECT discord_token FROM sessions WHERE sid = ? AND expires_at > ?").pluck().get(sid, Date.now()) as Buffer | null | undefined;
    return blob ? secrets.openBlob(TOKEN_PURPOSE, blob, sid) : null;
  }
}

// 비밀값과 다른 키로 암호화한다(store/secrets 의 용도)
const TOKEN_PURPOSE = "discord-token";

/** 열린 저장소들(종료 순서의 finishSessions) */
const live = new Set<SqliteSessionStore>();

/** 종료 순서에서: 열린 저장소마다 삭제하지 못한 행을 마지막으로 다시 삭제한다 */
function finishSessions() {
  for (const store of live) {
    try {
      store.finish();
    } catch (error) {
      log.error(`로그인 세션 저장소 마무리 실패: ${messageOf(error)}`);
    }
  }
}

export { SqliteSessionStore, SESSION_MAX_MS, finishSessions };

/** 요청의 세션 저장소가 디스코드 토큰을 다루면 그것. 아니면 null(테스트의 메모리 저장소) */
function tokenStoreOf(req: { sessionStore?: unknown }): SqliteSessionStore | null {
  return req.sessionStore instanceof SqliteSessionStore ? req.sessionStore : null;
}

export { tokenStoreOf };
