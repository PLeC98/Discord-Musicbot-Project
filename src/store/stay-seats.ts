// 24/7 자리: 서버마다 봇이 머무는 음성 채널. 실행 중에는 메모리가 정본이고 state.db 는 다시 시작할 때 읽는 사본이다.
// 퇴장 타이머(player/idle-leave)가 자주 묻고 시험은 DB 를 열지 않으므로, 읽기는 메모리만 본다(기동 때 load 로 채운다)

import { stateDb } from "./state-db.ts";

type Seat = { channelId: string; setBy: string | null; setAt: number };

const seats = new Map<string, Seat>();

// 열기 전에 부르면 던진다
const conn = () => stateDb.get();

/** DB 의 자리를 메모리로 읽는다. 기동 때 DB 를 연 뒤 한 번 */
function load() {
  seats.clear();
  const rows = conn().prepare("SELECT guild_id, channel_id, set_by, set_at FROM stay_seats").all() as Array<{ guild_id: string; channel_id: string; set_by: string | null; set_at: number }>;
  for (const r of rows) seats.set(r.guild_id, { channelId: r.channel_id, setBy: r.set_by, setAt: r.set_at });
}

/** 그 서버의 자리. 없으면 null */
const seatOf = (guildId: string): Seat | null => seats.get(guildId) ?? null;

/** 모든 자리 [서버 ID, 자리] */
const all = (): Array<[string, Seat]> => [...seats.entries()];

/** 자리를 적는다(켜기, 옮겨짐을 따라감). DB 가 열려 있지 않으면 던진다 */
function set(guildId: string, channelId: string, setBy: string | null = null) {
  const seat = { channelId, setBy: setBy ?? seats.get(guildId)?.setBy ?? null, setAt: Date.now() };
  conn()
    .prepare(
      `INSERT INTO stay_seats (guild_id, channel_id, set_by, set_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, set_by = excluded.set_by, set_at = excluded.set_at`,
    )
    .run(guildId, seat.channelId, seat.setBy, seat.setAt);
  seats.set(guildId, seat);
}

/** 자리를 지운다. 있었으면 true */
function clear(guildId: string) {
  if (!seats.has(guildId)) return false;
  conn().prepare("DELETE FROM stay_seats WHERE guild_id = ?").run(guildId);
  seats.delete(guildId);
  return true;
}

export { load, seatOf, all, set, clear };
export type { Seat };
