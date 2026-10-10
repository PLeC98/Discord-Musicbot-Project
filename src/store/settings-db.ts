// 설정 DB(settings.db). 사람이 정한 값만 담는다. 지우지 않는다.
// 표는 "열쇠 → JSON 문서 + 저장 번호" 꼴이라 구조를 거의 바꾸지 않고, 문서 모양은 코드가 읽을 때 맞춘다(옮기기 코드를 두지 않는다).
// 구조 버전이 맞지 않으면 열지 않고 멈춘다. 기본값으로 조용히 켜지면 정한 값을 잃은 줄 모른다.

import { DbFile } from "./sqlite.ts";
import type { Db } from "./sqlite.ts";

const VERSION = 1;

const settingsDb = new DbFile({
  label: "설정 DB",
  fileName: "settings.db",
  version: VERSION,
  synchronous: "FULL",
  onMismatch: "stop",
  createTables,
  mismatchHint: (found, file) => `설정 DB 구조가 이 봇과 맞지 않아 열지 않습니다 (DB v${found}, 봇 v${VERSION}): ${file}. 설정을 지우지 않으려고 멈춥니다. 이 DB 를 만든 버전의 봇으로 실행하세요.`,
});

function createTables(db: Db) {
  db.exec(`
    -- 서버별 설정. 서버마다 문서 하나(store/guild-settings 가 모양을 맞춘다)
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id    TEXT    PRIMARY KEY,
      data_json   TEXT    NOT NULL,
      revision    INTEGER NOT NULL DEFAULT 1,
      updated_at  INTEGER NOT NULL
    );
  `);
}

export { settingsDb, createTables };
