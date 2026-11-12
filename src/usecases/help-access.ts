// /help 의 자물쇠: 보는 사람이 권한으로 그 등급의 명령을 쓸 수 있나. 음성 채널, 재생 상태는 보지 않는다(실행할 때 알린다)

import type { GuildMember } from "discord.js";
import type { HelpTier, Open } from "../ui/help-lines.ts";
import * as GuildSettingsManager from "../store/guild-settings.ts";
import { isBotOwner, isDj, isServerManager } from "./permissions.ts";

/** 그 사람의 판정. dj-or-requester 는 DJ 가 아니어도 자기가 넣은 곡에 쓸 수 있어 열어 둔다 */
async function helpAccess(member: GuildMember): Promise<Open> {
  const dj = await isDj(member);
  const botChannelId = await GuildSettingsManager.getBotChannel(member.guild.id);
  const botChannel = Boolean(botChannelId && member.guild.channels.cache.has(botChannelId));
  const open: Record<HelpTier, boolean> = {
    everyone: true,
    dj,
    "dj-or-requester": true,
    "dj-outside-bot-channel": dj || botChannel,
    "server-manager": isServerManager(member),
    owner: isBotOwner(member.id),
  };
  return (tier) => open[tier];
}

export { helpAccess };
