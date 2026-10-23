// 봇이 그 음성 채널에 들어갈 수 있는가. 디스코드는 안 되는 접속을 거절하지 않고 답 없이 두니 붙기 전에 본다(부르기 · 세션 복원)

import { ChannelType, PermissionFlagsBits } from "discord.js";
import type { Code } from "../rules/problems.ts";

type Channel = { type?: ChannelType; full?: boolean; permissionsFor(member: never): { has(bit: bigint): boolean } | null };
type Me = { communicationDisabledUntilTimestamp?: number | null } | null | undefined;

/**
 * 들어갈 수 없는 까닭. 들어갈 수 있으면 null. 채널 보기 · 연결 · 말하기가 있어야 하고, 타임아웃이면 못 들어간다. 꽉 찬 채널은 멤버 이동 권한이 있어야 들어간다.
 * 스테이지는 말하기 권한 대신 발언자가 될 길이 있어야 한다: 스스로 발언자가 되거나(멤버 음소거) 발언을 요청한다(발언권 요청, player/voice-link).
 * inside: 봇이 이미 그 채널에 있다(꽉 찬 채널의 인원에 봇이 든다. 인원은 보지 않는다)
 */
function voiceJoinDenied(channel: Channel, me: Me, { inside = false } = {}): Extract<Code, "permission-voice" | "permission-stage" | "voice-full" | "bot-timed-out"> | null {
  const permissions = me ? channel.permissionsFor(me as never) : null;
  if (!permissions) return "permission-voice";
  const denied = speakDenied(permissions, channel.type === ChannelType.GuildStageVoice);
  if (denied) return denied;
  if ((me?.communicationDisabledUntilTimestamp ?? 0) > Date.now()) return "bot-timed-out";
  if (!inside && channel.full && !permissions.has(PermissionFlagsBits.MoveMembers)) return "voice-full";
  return null;
}

// 들어가 말할 권한. 스테이지는 말하기 권한이 없고 발언자가 될 길을 본다
function speakDenied(permissions: { has(bit: bigint): boolean }, stage: boolean) {
  const has = (bit: bigint) => permissions.has(bit);
  if (!has(PermissionFlagsBits.ViewChannel) || !has(PermissionFlagsBits.Connect)) return "permission-voice";
  if (!stage) return has(PermissionFlagsBits.Speak) ? null : "permission-voice";
  return has(PermissionFlagsBits.MuteMembers) || has(PermissionFlagsBits.RequestToSpeak) ? null : "permission-stage";
}

export { voiceJoinDenied };
