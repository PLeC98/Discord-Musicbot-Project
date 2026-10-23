// 봇이 그 음성 채널에 들어갈 수 있는가. 디스코드는 안 되는 접속을 거절하지 않고 답 없이 두니 붙기 전에 본다(부르기 · 세션 복원)

import { PermissionFlagsBits } from "discord.js";
import type { Code } from "../rules/problems.ts";

type Channel = { full?: boolean; permissionsFor(member: never): { has(bit: bigint): boolean } | null };
type Me = { communicationDisabledUntilTimestamp?: number | null } | null | undefined;

/**
 * 들어갈 수 없는 까닭. 들어갈 수 있으면 null. 채널 보기 · 연결 · 말하기가 있어야 하고, 타임아웃이면 못 들어간다. 꽉 찬 채널은 멤버 이동 권한이 있어야 들어간다.
 * inside: 봇이 이미 그 채널에 있다(꽉 찬 채널의 인원에 봇이 든다. 인원은 보지 않는다)
 */
function voiceJoinDenied(channel: Channel, me: Me, { inside = false } = {}): Extract<Code, "permission-voice" | "voice-full" | "bot-timed-out"> | null {
  const permissions = me ? channel.permissionsFor(me as never) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
    return "permission-voice";
  }
  if ((me?.communicationDisabledUntilTimestamp ?? 0) > Date.now()) return "bot-timed-out";
  if (!inside && channel.full && !permissions.has(PermissionFlagsBits.MoveMembers)) return "voice-full";
  return null;
}

export { voiceJoinDenied };
