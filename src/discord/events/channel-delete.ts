// 전용 채널이 삭제되면 전용 채널 설정을 비운다. 그 뒤로는 전용 채널이 없는 서버처럼 요청한 채널에 패널을 올린다. 24/7 자리 채널이면 자리를 끈다(app/stay-keeper).
// 디스코드가 채널 삭제를 알려 올 때만 온다(게이트웨이 CHANNEL_DELETE). 디스코드에 닿지 않는 동안에는 알림이 없을 뿐 삭제됐다고 보지 않는다.

import { Events } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import * as guildSettings from "../../store/guild-settings.ts";
import type { ClientEvent } from "../../app/main.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { L } from "../../infra/log/text.ts";

const exported: ClientEvent<Events.ChannelDelete> = {
  name: Events.ChannelDelete,
  async execute({ panels, stay }, channel) {
    if (channel.isDMBased()) return;
    const guild = channel.guild;
    stay.onChannelDeleted(guild, channel.id);
    if ((await guildSettings.getBotChannel(guild.id)) !== channel.id) return;
    // 비우기에 실패해도 여기서 잡는다(밖으로 새면 그 서버를 다시 시작한다). 채널은 이미 없으니 패널은 성공 여부와 상관없이 처리한다
    try {
      await guildSettings.clearBotChannel(guild.id);
      log.info(L.guild.botChannelDeletedCleared({ channel: channel.name, guild: guild.name }));
    } catch (error) {
      log.error(L.guild.botChannelDeletedClearFailed({ channel: channel.name, guild: guild.name, error: messageOf(error) }));
    }
    await panels.onBotChannelChanged(guild);
  },
};
export default exported;
