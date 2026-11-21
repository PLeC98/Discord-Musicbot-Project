// 사람별 데이터 DB(users.db). 그 사람 본인이 정한 값(개인 언어)을 담는다. 설정 DB와 따로 두는 까닭은 되돌리기와 지우기다:
// 설정 스냅샷을 복원해도 사람들의 선택이 되돌아가면 안 되고, 지우기 요청은 스냅샷에 남지 않게 한 번에 지운다.
// 구조 버전이 맞지 않으면 열지 않고 멈춘다(새로 만들어 사람들의 선택을 지우지 않는다)

import { DbFile } from "./sqlite.ts";
import type { Db } from "./sqlite.ts";

const VERSION = 1;

const usersDb = new DbFile({
  label: "사람별 데이터 DB",
  fileName: "users.db",
  version: VERSION,
  synchronous: "FULL",
  onMismatch: {
    hint: (found, file) => `사람별 데이터 DB 구조가 이 봇과 맞지 않음(DB v${found}, 봇 v${VERSION}): ${file}. 사람들의 선택을 지우지 않도록 새로 만들지 않음. 이 DB를 만든 버전의 봇으로 실행하세요`,
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

export { usersDb };
