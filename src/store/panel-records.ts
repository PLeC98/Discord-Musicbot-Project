// 서버당 하나뿐인 현재 재생 패널의 자리(state.db). 사용자 설정이 아니라 옛 패널을 치우는 기준이다(ui/panel-location).

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import { stateDb } from "./state-db.ts";
import { codeOf } from "../rules/error-kind.ts";

/** 현재 재생 패널의 자리 */
type PanelRecord = { channelId: string | null; messageId: string };

// 열기 전에 부르면 던진다
const conn = () => stateDb.get();

// 서버마다 읽어 둔 자리. 없으면 null 을 담는다
const cache = new Map<string, PanelRecord | null>();

// 테스트 시임. 읽어 둔 것을 버린다
function _reset() {
  cache.clear();
}

/** { channelId, messageId } 또는 null */
async function getPanel(guildId: string): Promise<PanelRecord | null> {
  if (cache.has(guildId)) return cache.get(guildId) ?? null;
  try {
    const row = conn().prepare("SELECT channel_id AS channelId, message_id AS messageId FROM now_playing_panel WHERE guild_id = ?").get(guildId) as PanelRecord | undefined;
    const record = row ? { channelId: row.channelId, messageId: row.messageId } : null;
    cache.set(guildId, record);
    return record;
  } catch (error) {
    if (codeOf(error) === "DB_NOT_OPEN") throw error;
    log.error("현재 재생 패널 자리 읽기 실패(옛 패널을 못 치운다):", error);
    return null;
  }
}

/** messageId가 null이면 비운다 */
async function setPanel(guildId: string, channelId: string | null, messageId: string | null | undefined) {
  try {
    if (messageId) {
      conn()
        .prepare(
          `INSERT INTO now_playing_panel (guild_id, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(guild_id) DO UPDATE SET
               channel_id = excluded.channel_id,
               message_id = excluded.message_id,
               updated_at = excluded.updated_at`,
        )
        .run(guildId, channelId, messageId, Date.now());
    } else {
      conn().prepare("DELETE FROM now_playing_panel WHERE guild_id = ?").run(guildId);
    }
    cache.set(guildId, messageId ? { channelId, messageId } : null);
  } catch (error) {
    if (codeOf(error) === "DB_NOT_OPEN") throw error;
    log.error("현재 재생 패널 자리 저장 실패:", error);
  }
}

/** 봇이 서버에서 나갔다. 읽어 둔 자리를 버린다(줄은 stateDb.forgetGuild 가 지운다) */
function forget(guildId: string) {
  cache.delete(guildId);
}

export { getPanel, setPanel, forget, _reset };
export type { PanelRecord };
