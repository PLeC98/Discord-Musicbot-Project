// 대시보드에서 올린 앱 이모지의 기록(settings.db 의 app_emojis). 동기화(app/app-emojis)가 이 id 는 운영자가 올린 것처럼 건드리지 않는다
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

export { uploadedIds, addUploaded, keepUploaded };
