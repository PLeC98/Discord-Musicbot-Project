// 앱 이모지 기록(settings.db). app_emojis: 대시보드에서 올린 id(동기화 app/app-emojis 가 운영자가 올린 것처럼 건드리지 않는다).
// app_emoji_chars: 대시보드 입력란이 앱 이모지를 그리는 문자(dashboard/app-emoji-glyphs)
import { settingsDb } from "./settings-db.ts";

const conn = () => settingsDb.get();

/** 대시보드에서 올린 앱 이모지 id 들 */
function uploadedIds(): Set<string> {
  const rows = conn().prepare("SELECT id FROM app_emojis").all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

function addUploaded(id: string) {
  conn().prepare("INSERT OR IGNORE INTO app_emojis (id, added_at) VALUES (?, ?)").run(id, Date.now());
}

/** 디스코드 앱에 없는 id 를 정리한다(지웠다, 개발자 포털에서 지웠다). 남은 id 수 */
function keepUploaded(existing: ReadonlySet<string>): number {
  const db = conn();
  return db.transaction(() => {
    for (const id of uploadedIds()) if (!existing.has(id)) db.prepare("DELETE FROM app_emojis WHERE id = ?").run(id);
    return uploadedIds().size;
  })();
}

/** 보조 사용자 정의 영역 A(U+F0000 ~ U+FFFFD) */
const FIRST_CHAR = 0xf0000;
const LAST_CHAR = 0xffffd;

/** 키마다 문자. 없으면 다음 번호를 주고 적는다(한 번 준 번호는 다시 쓰지 않는다). 영역을 다 쓰면 그 키는 빠진다 */
function charsFor(keys: readonly string[]): Map<string, number> {
  const db = conn();
  return db.transaction(() => {
    const rows = db.prepare("SELECT key, codepoint FROM app_emoji_chars").all() as Array<{ key: string; codepoint: number }>;
    const chars = new Map(rows.map((row) => [row.key, row.codepoint]));
    let next = Math.max(FIRST_CHAR - 1, ...rows.map((row) => row.codepoint)) + 1;
    const insert = db.prepare("INSERT INTO app_emoji_chars (key, codepoint) VALUES (?, ?)");
    for (const key of keys) {
      if (chars.has(key) || next > LAST_CHAR) continue;
      insert.run(key, next);
      chars.set(key, next++);
    }
    return new Map(keys.flatMap((key) => (chars.has(key) ? [[key, chars.get(key)!] as const] : [])));
  })();
}

export { uploadedIds, addUploaded, keepUploaded, charsFor, FIRST_CHAR, LAST_CHAR };
