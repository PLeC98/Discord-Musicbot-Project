// 전용 채널이 지워지면 전용 채널 설정을 비운다. 그 뒤로는 전용 채널이 없는 서버처럼 요청한 채널에 패널을 올린다.
// 디스코드가 채널 삭제를 알려 올 때만 온다(게이트웨이 CHANNEL_DELETE). 디스코드에 닿지 않는 동안에는 알림이 없을 뿐 지워졌다고 보지 않는다.

import { Events } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import type { ClientEvent } from "../src/app/main.ts";

const exported: ClientEvent<Events.ChannelDelete> = {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (channel.isDMBased()) return;
    const guild = channel.guild;
    if ((await GuildSettingsManager.getBotChannel(guild.id)) !== channel.id) return;
    await GuildSettingsManager.clearBotChannel(guild.id);
    log.info(`전용 채널 "${channel.name}" 이 지워져 전용 채널 설정을 비웁니다 (${guild.name})`);
    await channel.client.panels?.onBotChannelChanged(guild);
  },
};
export default exported;
