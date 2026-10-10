import path from "path";
import fs from "fs";
import { Store, type SessionData } from "express-session";
import Database, { type Statement } from "better-sqlite3";
import { PROJECT } from "../infra/project-paths.ts";
import { ownerOnly } from "../infra/owner-only.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { messageOf } from "../rules/error-kind.ts";

// express-session의 기본 MemoryStore 대체:
// 재시작 시 세션 소실(로그인 풀림)과 메모리 누수 경고를 SQLite 영속화로 해소.
// 캐시 DB와 같은 better-sqlite3 사용, 파일은 분리(database/sessions.db).
const DB_PATH = path.join(PROJECT.database, "sessions.db");

// maxAge 미설정 쿠키(브라우저 세션 쿠키)의 서버측 보관 기한 폴백
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Done = (err?: unknown) => void;
// 부른 쪽이 결과를 기다리지 않을 때
const unheard: Done = () => {
  /* 들을 사람이 없다 */
};

class SqliteSessionStore extends Store {
  db: Database.Database;
  _getStmt: Statement<[string], { data: string; expires_at: number }>;
  _setStmt: Statement<[string, string, number]>;
  _touchStmt: Statement<[number, string]>;
  _destroyStmt: Statement<[string]>;
  _pruneStmt: Statement<[number]>;
  _pruneTimer: NodeJS.Timeout;

  // dbPath는 테스트 시임 (임시 DB. 운영 DB 미접촉)
  constructor({ dbPath = DB_PATH, pruneIntervalMs = 60 * 60 * 1000 }: { dbPath?: string; pruneIntervalMs?: number } = {}) {
    super();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    ownerOnly(dbPath); // 로그인 세션이 든다
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    );

    this._getStmt = this.db.prepare("SELECT data, expires_at FROM sessions WHERE sid = ?");
    this._setStmt = this.db.prepare("INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at");
    this._touchStmt = this.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?");
    this._destroyStmt = this.db.prepare("DELETE FROM sessions WHERE sid = ?");
    this._pruneStmt = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

    this.prune(); // 기동 시 1회 + 주기 정리
    this._pruneTimer = setInterval(() => {
      try {
        this.prune();
      } catch {
        /* 정리 실패는 다음 주기에 재시도. 서비스에 영향 없음 */
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

  // 읽을 수 없는 행은 없는 세션으로 보고 지운다. 오류로 넘기면 그 쿠키의 요청이 쿠키가 끝날 때까지 모두 500 이 된다
  _parse(sid: string, data: string): SessionData | null {
    try {
      return JSON.parse(data);
    } catch (error) {
      this._destroyStmt.run(sid);
      log.warn(`읽을 수 없는 로그인 세션 하나를 지웠습니다(그 사용자는 다시 로그인합니다): ${messageOf(error)}`);
      return null;
    }
  }

  set(sid: string, session: SessionData, cb: Done = unheard) {
    try {
      this._setStmt.run(sid, JSON.stringify(session), this._expiresAt(session));
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  // rolling/유휴 갱신. 데이터 재직렬화 없이 만료만 연장
  touch(sid: string, session: SessionData, cb: Done = unheard) {
    try {
      this._touchStmt.run(this._expiresAt(session), sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  destroy(sid: string, cb: Done = unheard) {
    try {
      this._destroyStmt.run(sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }

  prune(now = Date.now()) {
    return this._pruneStmt.run(now).changes;
  }

  close() {
    clearInterval(this._pruneTimer);
    this.db.close();
  }
}

export { SqliteSessionStore };
