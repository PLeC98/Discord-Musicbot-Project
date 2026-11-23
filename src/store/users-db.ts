// 사용자 데이터 DB(users.db). 그 사람 본인이 정한 값(개인 언어)을 담는다. 설정 DB와 따로 두는 까닭은 되돌리기와 지우기다:
// 설정 스냅샷을 복원해도 사람들의 선택이 되돌아가면 안 되고, 지우기 요청은 스냅샷에 남지 않게 한 번에 지운다.
// 구조 버전이 맞지 않으면 열지 않고 멈춘다(새로 만들어 사람들의 선택을 지우지 않는다).
// 명령 전체 백업은 이 파일의 사본을 users.restore.db로 담고, 다음 기동이 열기 전에 교체한다(풀어서 users.db를 덮으면 남은 -wal이 새 파일에 얹혀 깨질 수 있다)

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { codedError } from "../rules/error-kind.ts";
import { DbFile } from "./sqlite.ts";
import type { Db } from "./sqlite.ts";
import { L } from "../infra/log/text.ts";

const VERSION = 1;

const usersDb = new DbFile({
  label: L.core.usersDbLabel(),
  fileName: "users.db",
  version: VERSION,
  synchronous: "FULL",
  onMismatch: {
    hint: (found, file) => L.core.usersDbSchemaMismatch({ dbVersion: found, botVersion: VERSION, file }),
  },
  createTables,
});

function createTables(db: Db) {
  db.exec(`
    -- 사람별 설정. 사람마다 문서 하나(store/user-settings가 모양을 맞춘다). 고른 것이 있는 사람만 행이 있다
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id     TEXT    PRIMARY KEY,
      data_json   TEXT    NOT NULL
    );
  `);
}

/** 명령 전체 백업이 담는 이름. 다음 기동이 users.db로 교체한다 */
const STAGED_USERS = "users.restore.db";

/**
 * 기동 시 users.db를 열기 전에. 풀어 둔 전체 백업의 사본(users.restore.db)이 있으면 지금 것을 지우고 교체한다(사본에 담긴 사람들의 선택으로 바꾼다). 교체했으면 true.
 * 구조 버전이 맞지 않으면 교체하지 않고 멈춘다(지금 것을 지우지 않는다, 사본은 남는다)
 */
function applyStagedUsers(dir: string): boolean {
  const staged = path.join(dir, STAGED_USERS);
  if (!fs.existsSync(staged)) return false;
  const db = new Database(staged, { readonly: true, fileMustExist: true });
  const found = (() => {
    try {
      return db.pragma("user_version", { simple: true }) as number;
    } finally {
      db.close();
    }
  })();
  if (found !== VERSION) throw Object.assign(codedError("RESTORE_FAILED", L.core.stagedUsersDbSkipped({ version: found, botVersion: VERSION, stagedFile: STAGED_USERS })), { dbFile: "users.db" });
  const current = path.join(dir, "users.db");
  try {
    for (const leftover of [current, `${current}-wal`, `${current}-shm`]) fs.rmSync(leftover, { force: true });
    fs.renameSync(staged, current);
    for (const leftover of [`${staged}-wal`, `${staged}-shm`]) fs.rmSync(leftover, { force: true });
  } catch (error) {
    throw Object.assign(codedError("RESTORE_FAILED", L.core.stagedUsersDbApplyFailed({ error: (error as Error).message }), { cause: error }), { dbFile: "users.db" });
  }
  return true;
}

export { usersDb, applyStagedUsers, STAGED_USERS };
