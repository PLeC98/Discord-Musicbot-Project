import { Store, type SessionData } from "express-session";
import type Database from "better-sqlite3";
import type { Statement } from "better-sqlite3";
import { DbFile } from "../store/sqlite.ts";
import { sessionDb } from "../store/session-db.ts";
import * as secrets from "../store/secrets.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { messageOf } from "../rules/error-kind.ts";

// express-session의 기본 MemoryStore 대체:
// 다시 시작할 때 세션 소실(로그인 풀림)과 메모리 누수 경고를 SQLite 영속화로 해소.
// 파일은 로그인 세션 DB(database/sessions.db, store/session-db). 다른 DB 와 함께 열린다.

// maxAge 미설정 쿠키(브라우저 세션 쿠키)의 서버측 보관 기한 폴백
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Done = (err?: unknown) => void;
// 부른 쪽이 결과를 기다리지 않을 때. 실패는 여기서 남긴다
const unheard =
  (what: string): Done =>
  (err) => {
    if (err) log.error(`로그인 세션 ${what} 실패: ${messageOf(err)}`);
  };

class SqliteSessionStore extends Store {
  db: Database.Database;
  _getStmt: Statement<[string], { data: string; expires_at: number }>;
  _setStmt: Statement<[string, string, number]>;
  _touchStmt: Statement<[number, string]>;
  _destroyStmt: Statement<[string]>;
  _pruneStmt: Statement<[number]>;
  _pruneTimer: NodeJS.Timeout;
  // dbPath 로 따로 연 파일(테스트). 닫을 때 같이 닫는다
  _own: DbFile | null = null;

  // dbPath는 테스트 시임 (임시 DB. 운영 DB 미접촉). 없으면 함께 연 로그인 세션 DB
  constructor({ dbPath, pruneIntervalMs = 60 * 60 * 1000 }: { dbPath?: string; pruneIntervalMs?: number } = {}) {
    super();
    if (dbPath) {
      this._own = new DbFile(sessionDb.spec);
      this._own.open(dbPath);
    }
    this.db = (this._own ?? sessionDb).get();

    this._getStmt = this.db.prepare("SELECT data, expires_at FROM sessions WHERE sid = ?");
    this._setStmt = this.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at");
    this._touchStmt = this.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?");
    this._destroyStmt = this.db.prepare("DELETE FROM sessions WHERE sid = ?");
    this._pruneStmt = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

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
  }

  _expiresAt(session: SessionData) {
    const expires = session?.cookie?.expires;
    const ts = expires ? new Date(expires).getTime() : NaN;
    return Number.isFinite(ts) ? ts : Date.now() + FALLBACK_TTL_MS;
  }

  // express-session Store 계약: 콜백 (err, session|null). better-sqlite3는 동기라 즉시 호출.
  get(sid: string, cb: (err: unknown, session?: SessionData | null) => void) {
    try {
      const row = this._getStmt.get(sid);
      if (!row || row.expires_at <= Date.now()) return cb(null, null);
      cb(null, this._parse(sid, row.data));
    } catch (e) {
      cb(e);
    }
  }

  // 읽을 수 없는 행은 없는 세션으로 보고 삭제한다. 오류로 넘기면 그 쿠키의 요청이 쿠키가 끝날 때까지 모두 500 이 된다
  _parse(sid: string, data: string): SessionData | null {
    try {
      return JSON.parse(data);
    } catch (error) {
      this._destroyStmt.run(sid);
      log.warn(`읽을 수 없는 로그인 세션 하나를 삭제했습니다(그 사용자는 다시 로그인합니다): ${messageOf(error)}`);
      return null;
    }
  }

  set(sid: string, session: SessionData, cb: Done = unheard("저장")) {
    try {
      this._setStmt.run(sid, JSON.stringify(session), this._expiresAt(session));
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  // rolling/유휴 갱신. 데이터 재직렬화 없이 만료만 연장
  touch(sid: string, session: SessionData, cb: Done = unheard("만료 연장")) {
    try {
      this._touchStmt.run(this._expiresAt(session), sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  destroy(sid: string, cb: Done = unheard("삭제")) {
    try {
      this._destroyStmt.run(sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  /** 그 사용자의 살아 있는 세션들(세션 id · 내용). 내용을 행마다 읽어 필터링한다(사용자 열은 따로 두지 않는다. 세션은 많아야 수십 개) */
  sessionsOf(userId: string, now = Date.now()): Array<{ sid: string; session: SessionData }> {
    const rows = this.db.prepare("SELECT sid, data FROM sessions WHERE expires_at > ?").all(now) as Array<{ sid: string; data: string }>;
    return rows.flatMap(({ sid, data }) => {
      try {
        const session = JSON.parse(data) as SessionData;
        return session.user?.id === userId ? [{ sid, session }] : [];
      } catch {
        return [];
      }
    });
  }

  prune(now = Date.now()) {
    return this._pruneStmt.run(now).changes;
  }

  close() {
    clearInterval(this._pruneTimer);
    this._own?.close();
  }

  // ── 디스코드 접근 토큰 ──
  // 로그인 때 받은 토큰을 세션 행에 암호문으로 둔다(세션 JSON 밖, 세션 ID 에 묶음). 세션 행과 함께 지워진다.
  // 세션을 저장(set)해도 이 열은 그대로다

  /** 그 세션 행에 토큰을 적는다. 행이 없으면(아직 저장 전) false */
  saveDiscordToken(sid: string, token: string) {
    return this.db.prepare("UPDATE sessions SET discord_token = ? WHERE sid = ?").run(secrets.sealBlob(TOKEN_PURPOSE, token, sid), sid).changes > 0;
  }

  /** 토큰. 없거나 풀리지 않으면(다른 SECRETS_KEY · 다른 행에서 옮김) null */
  readDiscordToken(sid: string) {
    const blob = this.db.prepare("SELECT discord_token FROM sessions WHERE sid = ? AND expires_at > ?").pluck().get(sid, Date.now()) as Buffer | null | undefined;
    return blob ? secrets.openBlob(TOKEN_PURPOSE, blob, sid) : null;
  }
}

// 비밀값과 다른 키로 잠근다(store/secrets 의 용도)
const TOKEN_PURPOSE = "discord-token";

export { SqliteSessionStore };

/** 요청의 세션 저장소가 디스코드 토큰을 다루면 그것. 아니면 null(테스트의 메모리 저장소) */
function tokenStoreOf(req: { sessionStore?: unknown }): SqliteSessionStore | null {
  return req.sessionStore instanceof SqliteSessionStore ? req.sessionStore : null;
}

export { tokenStoreOf };
