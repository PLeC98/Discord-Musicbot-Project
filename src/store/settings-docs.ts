// 설정 문서(settings.db 의 documents). 이름 → JSON + 저장 번호.
// 저장할 때 받은 번호가 지금 번호와 다르면 거절한다(다른 탭 · 다른 사람이 그사이 저장했다). 문서 모양은 읽는 쪽이 맞춘다

import Database from "better-sqlite3";
import fs from "fs";
import { codedError } from "../rules/error-kind.ts";
import { settingsDb } from "./settings-db.ts";

/** 문서 하나. 없으면 data 는 null, revision 은 0 */
type Doc = { data: unknown; revision: number };

const conn = () => settingsDb.get();

function parse(raw: string | undefined): unknown {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // 망가진 문서는 없는 것으로(읽는 쪽이 기본값으로 돈다)
  }
}

function read(name: string): Doc {
  const row = conn().prepare("SELECT data_json, revision FROM documents WHERE name = ?").get(name) as { data_json: string; revision: number } | undefined;
  return { data: parse(row?.data_json), revision: row?.revision ?? 0 };
}

/** 쓸 문서 하나. revision 은 화면이 읽었을 때의 번호 */
type Write = { name: string; data: unknown; revision: number };

function writeOne({ name, data, revision }: Write): number {
  const now = read(name).revision;
  if (now !== revision) throw codedError("REVISION_CONFLICT", `${name} 문서가 그사이 바뀌었습니다(읽은 번호 ${revision}, 지금 ${now})`);
  conn()
    .prepare(
      `INSERT INTO documents (name, data_json, revision) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET data_json = excluded.data_json, revision = excluded.revision`,
    )
    .run(name, JSON.stringify(data), now + 1);
  return now + 1;
}

/** 저장. 번호가 지금 번호와 다르면 REVISION_CONFLICT 로 던진다. 새 번호를 돌려준다 */
const write = (name: string, data: unknown, revision: number): number => writeAll([{ name, data, revision }])[0];

/** 여러 문서를 한 트랜잭션으로. 하나라도 실패하면 아무것도 쓰지 않는다. 새 번호들을 같은 순서로 돌려준다 */
function writeAll(writes: Write[]): number[] {
  return conn().transaction(() => writes.map(writeOne))();
}

/**
 * 봇이 켜지지 않은 채(명령 배포 스크립트) 문서 하나를 읽는다. 읽기 전용으로 열고 바로 닫는다(파일을 만들지 않고 구조도 건드리지 않는다).
 * 파일이 없거나 문서가 없으면 null
 */
function peek(file: string, name: string): unknown {
  if (!fs.existsSync(file)) return null;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT data_json FROM documents WHERE name = ?").get(name) as { data_json: string } | undefined;
    return parse(row?.data_json);
  } catch {
    return null; // 표가 없다(옛 파일)
  } finally {
    db.close();
  }
}

export { read, write, writeAll, peek };
export type { Doc, Write };
