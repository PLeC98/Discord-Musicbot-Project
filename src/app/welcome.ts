// 봇이 새 서버에 들어왔을 때 올리는 안내 메시지 하나(시작하는 법, /help, 전용 채널, 웹 대시보드). 운영 조절값 WELCOME_MESSAGE_ENABLED 로 끈다.
// 공개로 올려 지울 수 없으니, 들어온 지 얼마 안 된 서버에만 올린다(이벤트가 이미 있던 서버로 와도 올리지 않게)

import { ActionRowBuilder, ChannelType, PermissionFlagsBits, type ButtonBuilder, type Guild, type GuildTextBasedChannel } from "discord.js";
import config from "../config/index.ts";
import * as GuildSettingsManager from "../store/guild-settings.ts";
import { commandMention } from "../ui/command-mentions.ts";
import { frame, post } from "../ui/frame.ts";
import { dashboardButton } from "../ui/dashboard-link.ts";
import * as welcomeText from "../ui/text/ko/welcome.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });

/** 들어온 지 이만큼 안이면 새로 들어온 서버로 본다 */
const RECENT_MS = 10 * 60_000;

/** 봇이 보고 글을 쓸 수 있는 텍스트 채널인가 */
function writable(guild: Guild, channel: GuildTextBasedChannel | null | undefined): channel is GuildTextBasedChannel {
  const me = guild.members.me;
  return Boolean(me && channel && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]));
}

/** 올릴 채널: 봇 전용 채널(다시 초대한 서버), 시스템 채널, 위치 순서로 첫 텍스트 채널 가운데 봇이 쓸 수 있는 첫 곳. 스레드는 보지 않는다(쓰는 권한이 따로다). 없으면 null */
async function welcomeChannel(guild: Guild): Promise<GuildTextBasedChannel | null> {
  const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
  const botChannel = botChannelId ? guild.channels.cache.get(botChannelId) : undefined;
  const candidates: Array<GuildTextBasedChannel | null> = [
    botChannel?.type === ChannelType.GuildText ? botChannel : null,
    guild.systemChannel,
    ...guild.channels.cache
      .filter((channel) => channel.type === ChannelType.GuildText)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .values(),
  ];
  return candidates.find((channel) => writable(guild, channel)) ?? null;
}

function welcomeView(guildId: string) {
  const mention = (name: string) => commandMention(name, guildId);
  const t = welcomeText.welcome({ play: mention("play"), join: mention("join"), help: mention("help"), setchannel: mention("setchannel") });
  const container = frame({ icon: "music", title: t.title, body: t.lines.join("\n") });
  const button = dashboardButton(t.dashboard);
  if (button) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
  return container;
}

/** 새 서버에 안내를 올린다. 보내다 실패하면 던진다(부르는 쪽이 남긴다) */
async function welcomeGuild(guild: Guild, now = Date.now()) {
  if (!config.bot.welcomeMessage) return;
  if (!guild.joinedTimestamp || now - guild.joinedTimestamp > RECENT_MS) {
    log.debug(`서버 ${guild.id}: 들어온 지 오래되어 안내 메시지를 올리지 않음`);
    return;
  }
  const channel = await welcomeChannel(guild);
  if (!channel) {
    log.warn(`새 서버 ${guild.name}(${guild.id})에 안내 메시지를 올릴 채널이 없음(봇이 보고 쓸 수 있는 텍스트 채널 없음)`);
    return;
  }
  await channel.send(post(welcomeView(guild.id)));
}

export { welcomeGuild, welcomeChannel, welcomeView, RECENT_MS };
