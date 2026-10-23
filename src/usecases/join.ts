// 봇 부르기. 디스코드 /join 과 대시보드 "봇 부르기"가 같이 쓴다. 판정과 일은 여기서, 결과를 어떻게 알릴지는 진입점이 정한다

import type { Guild, GuildMember, GuildTextBasedChannel } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player", sub: "join" });
import config from "../config/index.ts";
import * as playerEvents from "../player/events.ts";
import type { Player } from "../player/player.ts";
import type { QueuedTrack } from "../player/track.ts";
import type { PlayerSeats } from "../player/registry.ts";
import { sessions, type RestoredSession } from "../store/player-sessions.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { messageOf } from "../rules/error-kind.ts";
import { ensurePlayer, resolveFallbackTextChannel } from "./add-tracks.ts";
import { joinDenied } from "./permissions.ts";
import { canPost } from "../ui/channels.ts";

type JoinRequest = { guild: Guild; member: GuildMember; textChannel?: GuildTextBasedChannel | null };

/**
 * refused: 부르지 않았다 · already: 이미 그 채널에 있다 · joined: 붙어서 곡을 기다린다 ·
 * restored: 저장한 세션을 복원했다(track 은 이어 튼 곡, 틀지 못했으면 null. left 는 남은 곡) · restore-error: 복원하다가 오류가 나 플레이어를 버렸다
 */
type JoinResult = { kind: "refused"; code: "must-be-in-voice" | "permission-voice" | "permission-stage" | "voice-full" | "bot-timed-out" | "bot-in-other-voice" | "voice-failed" } | { kind: "already"; player: Player } | { kind: "joined"; player: Player } | { kind: "restored"; player: Player; track: QueuedTrack | null; left: number } | { kind: "restore-error" };

/**
 * 부른 사람의 음성 채널에 봇을 붙인다. 저장한 세션이 있으면 복원하고, 없으면 곡을 기다리다 나갈 예약을 건다.
 * restoring 은 세션 복원을 시작할 때 부른다(디스코드는 "불러오는 중"을 먼저 답한다).
 * 텍스트 채널을 주지 않으면(대시보드) 서버의 전용 채널을 쓴다
 */
async function join(bot: { players: Pick<PlayerSeats, "get" | "set"> }, { guild, member, textChannel = null }: JoinRequest, { restoring }: { restoring?: () => Promise<unknown> } = {}): Promise<JoinResult> {
  const channel = member.voice.channel;
  const refused = refusal(guild, member);
  if (refused || !channel) return { kind: "refused", code: refused ?? "must-be-in-voice" };

  // 이미 붙어 있음(붙는 중 · 끊겨 다시 붙는 중 포함)
  const existing = bot.players.get(guild.id);
  if (existing?.voice.isAlive()) return { kind: "already", player: existing };

  // /leave 나 종료가 저장해 둔 세션
  const saved = sessions().load(guild.id);

  // 붙지 않은 채 남은 플레이어(붙기 실패 등)는 정리하고 새로 만든다. 그냥 버리면 타이머 · 상태 동기화 · 캐시 퇴거 보호가
  // 걸린 채 새 플레이어와 같은 서버 키를 두고 경쟁한다. 저장한 세션은 그대로 두어 아래에서 복원한다
  if (existing) await existing.dispose({ reason: "봇 부르기 교체", session: "keep" });

  // 친 채널에 글을 올릴 수 없으면 전용 채널(세션 저장이 텍스트 채널을 남긴다)
  const player = ensurePlayer(bot, { guild, textChannel: canPost(textChannel) ? textChannel : await resolveFallbackTextChannel(guild), voiceChannel: channel });
  if (saved?.current) {
    await restoring?.();
    return restore(player, saved);
  }

  try {
    await player.voice.connect();
  } catch {
    // 까닭은 음성 연결이 남긴다
    await player.dispose({ reason: "음성 채널 접속 실패", session: "keep" });
    return { kind: "refused", code: "voice-failed" };
  }
  waitEmpty(player);
  return { kind: "joined", player };
}

// 부를 수 없는 까닭. 부를 수 있으면 null
function refusal(guild: Guild, member: GuildMember) {
  const botChannel = guild.members.me?.voice?.channel;
  const inside = Boolean(botChannel) && botChannel?.id === member.voice.channel?.id;
  const denied = joinDenied(member, { inside });
  if (denied) return denied;
  // 다른 채널에서 쓰는 봇은 옮기지 않는다(옮기려면 디스코드에서 끌어다 놓는다)
  if (botChannel && !inside) return "bot-in-other-voice" as const;
  return null;
}

// 저장한 세션을 복원한다. 채널 알림은 내지 않는다(진입점이 결과를 알린다)
async function restore(player: Player, saved: RestoredSession): Promise<JoinResult> {
  try {
    const outcome = await player.persistence.restoreFromState(saved, { announce: false });
    // 재생 중이던 곡이 저장된 세션만 복원하니 틀 곡이 없는 결과(empty)는 나오지 않는다
    return { kind: "restored", player, track: outcome === "restored" ? player.currentTrack : null, left: player.queue.length };
  } catch (error) {
    log.error("세션 복원 실패:", messageOf(error));
    await player.dispose({ reason: "세션 복원 실패", session: "keep" });
    return { kind: "restore-error" };
  }
}

// 틀 것 없이 들어왔다. 곡이 끝났을 때처럼 잠시 뒤 나가고, 패널에도 그렇게 적는다
function waitEmpty(player: Player) {
  bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
  if (config.bot.leaveDelayQueueEmptyMs > 0) player.idle.scheduleEmpty("곡 없이 대기");
  playerEvents.ended(player, "joined").catch((error) => log.warn(`참가 뒤 패널 갱신 실패: ${messageOf(error)}`));
}

export { join };
export type { JoinResult };
