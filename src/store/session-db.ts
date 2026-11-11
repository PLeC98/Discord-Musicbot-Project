// 로그인 세션 DB(sessions.db). 대시보드 로그인 세션(dashboard/session-store)과 그 세션의 디스코드 접근 토큰, 기기 기록(암호문).
// 다른 DB 와 함께 연다. 구조 버전이 맞지 않으면 열지 않고 멈춘다(삭제하고 다시 시작하라고 안내한다. 잃는 것은 로그인뿐이다).

import { DbFile } from "./sqlite.ts";
import type { Db } from "./sqlite.ts";

const sessionDb = new DbFile({
  label: "로그인 세션 DB",
  fileName: "sessions.db",
  // 1: 세션마다 디스코드 접근 토큰(sessions.discord_token)
  version: 1,
  synchronous: "NORMAL",
  onMismatch: { lost: "대시보드 로그인이 모두 풀림(다시 로그인하면 됨)" },
  createTables,
});

function createTables(db: Db) {
  db.exec(`
    -- data: express-session 의 세션(JSON). discord_token: 로그인 때 받은 디스코드 접근 토큰(store/secrets 의 sealBlob, 세션 ID 에 묶음). 세션 행과 함께 지워진다
    CREATE TABLE IF NOT EXISTS sessions (
      sid           TEXT    PRIMARY KEY,
      data          TEXT    NOT NULL,
      expires_at    INTEGER NOT NULL,
      discord_token BLOB
    );
    -- device: 세션의 기기 기록(dashboard/login-devices, sealBlob, 세션 ID에 묶음). 세션 내용 밖에 둬서 기기 기록을 다시 적는 요청이 세션 전체를 저장하지 않는다. 세션 행과 함께 지워진다
    CREATE TABLE IF NOT EXISTS session_devices (
      sid    TEXT PRIMARY KEY REFERENCES sessions(sid) ON DELETE CASCADE,
      device BLOB NOT NULL
    );
  `);
}

export { sessionDb };
