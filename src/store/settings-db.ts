// 설정 DB(settings.db). 사람이 정한 값만 담는다. 지우지 않는다.
// 표는 "열쇠 → JSON 문서" 꼴이라 구조를 거의 바꾸지 않고, 문서 모양은 코드가 읽을 때 맞춘다(옮기기 코드를 두지 않는다). 설정 문서는 저장 번호를 함께 둔다(두 탭이 서로 덮지 않게).
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
    -- 서버별 설정. 서버마다 문서 하나(store/guild-settings 가 모양을 맞춘다).
    -- 저장 번호가 없다: 칸 하나씩 한 트랜잭션으로 고쳐 쓰므로 다른 칸을 덮지 않고, 같은 칸은 나중 저장이 맞다
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id    TEXT    PRIMARY KEY,
      data_json   TEXT    NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    -- 설정 문서. 이름 → JSON + 저장 번호(옛 번호에서 저장하면 거절해 두 탭이 서로 덮지 않게). store/settings-docs
    CREATE TABLE IF NOT EXISTS documents (
      name        TEXT    PRIMARY KEY,
      data_json   TEXT    NOT NULL,
      revision    INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    -- 비밀값. 값마다 SECRETS_KEY 로 암호화한다(store/secrets). 평문은 끝 네 글자(last4)뿐이다.
    -- key_id: 어느 키로 잠갔나(키의 지문). provider · endpoint: 키를 묶은 곳. 인증 데이터에도 들어가 칸만 바꾸면 풀리지 않는다
    CREATE TABLE IF NOT EXISTS secrets (
      name        TEXT    PRIMARY KEY,
      format      INTEGER NOT NULL,
      key_id      TEXT    NOT NULL,
      provider    TEXT    NOT NULL,
      endpoint    TEXT    NOT NULL,
      iv          BLOB    NOT NULL,
      tag         BLOB    NOT NULL,
      ciphertext  BLOB    NOT NULL,
      last4       TEXT    NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
}

export { settingsDb, createTables };
