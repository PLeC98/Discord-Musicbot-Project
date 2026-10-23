// 채널 판정. 디스코드 채널 종류 가운데 글을 보낼 수 있는 것만 필터링한다.

import { PermissionFlagsBits } from "discord.js";

/** 글을 보낼 수 있는 채널. 가짜 채널도 같은 필드(send)로 구분한다 */
function canSend<C>(channel: C | null | undefined): channel is Extract<C, { send: unknown }> {
  return typeof (channel as { send?: unknown } | null | undefined)?.send === "function";
}

type Seen = {
  isThread?: () => boolean;
  sendable?: boolean;
  permissionsFor?: (member: never) => { has(bit: bigint): boolean } | null;
  guild?: { members?: { me?: { communicationDisabledUntilTimestamp?: number | null } | null } };
};

// 봇이 그 채널에서 그 권한들을 갖는가. 서버 채널이 아닌 것(DM)은 권한이 없다
function botHas(channel: Seen, bits: bigint[]) {
  const me = channel.guild?.members?.me;
  if (typeof channel.permissionsFor !== "function" || !me) return true;
  const permissions = channel.permissionsFor(me as never);
  return Boolean(permissions) && bits.every((bit) => permissions?.has(bit));
}

/**
 * 봇이 그 채널에 글을 올릴 수 있는가. 채널 권한 덮어쓰기 · 타임아웃까지 본다(디스코드는 보내 봐야 거절한다).
 * 스레드는 discord.js 가 본다(비공개 스레드는 봇이 들어가 있어야 한다)
 */
function canPost<C>(channel: C | null | undefined): channel is Extract<C, { send: unknown }> {
  if (!canSend(channel)) return false;
  const seen = channel as Seen;
  if (seen.isThread?.()) return seen.sendable !== false;
  if (!botHas(seen, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return false;
  return (seen.guild?.members?.me?.communicationDisabledUntilTimestamp ?? 0) <= Date.now();
}

/** 재생 패널을 올릴 수 있는가. 패널은 썸네일 파일을 붙인다(그림이 없는 곡 · 끝난 패널) */
function canPostPanel<C>(channel: C | null | undefined): channel is Extract<C, { send: unknown }> {
  return canPost(channel) && botHas(channel as Seen, [PermissionFlagsBits.AttachFiles]);
}

export { canSend, canPost, canPostPanel };
