// 봇이 서버에서 나갔다(내보내졌거나 서버가 삭제됐다). 그 서버의 플레이어를 내리고 실행 상태(저장된 대기열 · 음성 채널 상태 · 패널 위치)를 삭제한다.
// 서버 설정은 남긴다. 다시 초대하면 그대로 쓴다. 디스코드 장애로 서버를 잠시 못 쓰게 된 것은 이 이벤트로 오지 않는다(GuildUnavailable).

import { Events } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import { forgetGuild } from "../../store/state-db.ts";
import * as panelRecords from "../../store/panel-records.ts";
import type { ClientEvent } from "../../app/main.ts";

const exported: ClientEvent<Events.GuildDelete> = {
  name: Events.GuildDelete,
  async execute({ players }, guild) {
    await players.get(guild.id)?.dispose({ reason: "서버에서 나감", session: "remove" });
    forgetGuild(guild.id, guild.channels.cache.keys());
    panelRecords.forget(guild.id);
    log.info(`서버에서 나갔습니다: ${guild.name} (${guild.id}). 저장된 대기열 · 패널 위치 · 음성 채널 상태를 삭제했습니다`);
  },
};
export default exported;
