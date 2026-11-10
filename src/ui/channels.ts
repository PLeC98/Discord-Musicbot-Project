// 채널 판정. 디스코드 채널 종류 가운데 글을 보낼 수 있는 것만 필터링한다.

import { PermissionFlagsBits, type GuildTextBasedChannel } from "discord.js";

/** 글을 보낼 수 있는 채널. 가짜 채널도 같은 필드(send)로 구분한다 */
function canSend<C>(channel: C | null | undefined): channel is Extract<C, { send: unknown }> {
  return typeof (channel as { send?: unknown } | null | undefined)?.send === "function";
}

/**
 * 봇이 이 채널에 재생 패널(첨부가 붙은 메시지)을 올릴 수 있나. permissionsFor 는 캐시 계산이라 암묵 규칙(보기 권한, 타임아웃)을 빼므로
 * 게터로 본다: 스레드는 sendable, 그 밖은 viewable 에 보내기, 첨부 권한과 타임아웃
 */
function canPostPanel(channel: GuildTextBasedChannel): boolean {
  if (!canSend(channel)) return false;
  const me = channel.guild.members.me;
  const attach = Boolean(me && channel.permissionsFor(me)?.has(PermissionFlagsBits.AttachFiles));
  if (channel.isThread()) return channel.sendable && attach;
  return channel.viewable && attach && Boolean(me && channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) && !me?.isCommunicationDisabled();
}

export { canSend, canPostPanel };
