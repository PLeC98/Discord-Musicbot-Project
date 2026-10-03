// 봇이 음성 채널 상태에 마지막으로 쓴 값. 재시작 뒤 채널에 올라와 있는 상태가 우리 것인지 알아볼 때 쓴다

import * as db from "./db.ts";

// 열기 전에 부르면 던진다
const conn = () => db.get();

/** 채널마다 마지막으로 쓴 값 [채널 ID, 상태] */
function load(): Array<[string, string]> {
  const rows = conn().prepare("SELECT channel_id, status FROM voice_status").all() as Array<{ channel_id: string; status: string }>;
  return rows.map((r) => [r.channel_id, r.status]);
}

// 비웠으면 지운다. 빈 상태는 누구든 쓸 수 있어 기억할 까닭이 없다
function save(channelId: string, status: string) {
  if (!status) {
    conn().prepare("DELETE FROM voice_status WHERE channel_id = ?").run(channelId);
    return;
  }
  conn().prepare("INSERT INTO voice_status (channel_id, status) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET status = excluded.status").run(channelId, status);
}

export { load, save };
