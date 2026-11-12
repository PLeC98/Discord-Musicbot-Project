// 명령을 지금 그 사람이 쓸 수 있는지(/help 명령: 의 "지금은").
// 명령 모듈이 실행 때 쓰는 확인을 help.gate 로 적고, 적지 않은 명령은 권한 등급의 기본 확인을 쓴다(재생 조작은 checkControl, 설정 명령은 서버 관리 권한)

import type { GuildMember } from "discord.js";
import type { Code } from "../rules/problems.ts";
import type { QueuedTrack } from "../player/track.ts";
import type { HelpEntry, HelpTier } from "../ui/help-lines.ts";
import { checkControl, isBotOwner, isServerManager } from "./permissions.ts";

/** 판정에 쓰는 그 서버의 지금 상태. player: 그 서버의 플레이어(없으면 undefined), botChannelId: 전용 채널(없거나 사라졌으면 null), channelId: 명령을 부른 채널 */
type GateContext = { player: { currentTrack?: Pick<QueuedTrack, "requestedBy"> | null } | undefined; botChannelId: string | null; channelId: string };
/** 막은 까닭(거절 코드), 자기가 넣은 곡에만 됨(own-track), 됨(null) */
type GateResult = Code | "own-track" | null;
type Gate = (member: GuildMember, context: GateContext) => GateResult | Promise<GateResult>;

const BY_TIER: Record<HelpTier, Gate> = {
  everyone: () => null,
  dj: (member) => checkControl(member),
  // DJ 가 아니어도 자기가 넣은 곡이면 된다. 같은 음성 채널 규칙은 그대로
  "dj-or-requester": async (member) => {
    const denied = await checkControl(member);
    return denied === "must-dj" ? "own-track" : denied;
  },
  "dj-outside-bot-channel": (member, { botChannelId, channelId }) => (botChannelId ? (channelId === botChannelId ? null : "only-in-bot-channel") : checkControl(member)),
  "server-manager": (member) => (isServerManager(member) ? null : "must-server-manager"),
  owner: (member) => (isBotOwner(member.id) ? null : "must-owner"),
};

function gateOf(help: HelpEntry): Gate {
  return help.gate ?? BY_TIER[help.tier];
}

export { gateOf, BY_TIER };
export type { Gate, GateContext, GateResult };
