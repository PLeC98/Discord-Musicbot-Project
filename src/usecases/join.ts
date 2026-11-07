// 봇 부르기. 디스코드 /join 과 대시보드 "봇 부르기"가 같이 쓴다. 판정과 일은 여기서, 결과를 어떻게 알릴지는 진입점이 정한다

import { PermissionFlagsBits, type Guild, type GuildMember, type GuildTextBasedChannel, type VoiceBasedChannel } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player", sub: "join" });
import * as playerEvents from "../player/events.ts";
import type { Player } from "../player/player.ts";
import type { QueuedTrack } from "../player/track.ts";
import type { PlayerSeats } from "../player/registry.ts";
import { sessions, type RestoredSession } from "../store/player-sessions.ts";
import { waitForRestore } from "../player/session-restore.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { isShuttingDown } from "../infra/shutdown-state.ts";
import { ensurePlayer, resolveFallbackTextChannel } from "./add-tracks.ts";

type JoinRequest = { guild: Guild; member: GuildMember; textChannel?: GuildTextBasedChannel | null };

/**
 * refused: 부르지 않았다, already: 이미 그 채널에 있다, joined: 붙어서 곡을 기다린다,
 * restored: 저장한 세션을 복원했다(track 은 이어 튼 곡, 틀지 못했으면 null. left 는 남은 곡. parked: 열지 못해 그 곡에서 멈춰 뒀다), restore-error: 복원하다가 오류가 나 플레이어를 버렸다
 */
type JoinResult = { kind: "refused"; code: "must-be-in-voice" | "permission-voice" | "bot-in-other-voice" | "voice-failed" | "bot-shutting-down" } | { kind: "already"; player: Player } | { kind: "joined"; player: Player } | { kind: "restored"; player: Player; track: QueuedTrack | null; left: number; parked: boolean } | { kind: "restore-error" };

/**
 * 부른 사람의 음성 채널에 봇을 붙인다. 저장한 세션이 있으면 복원하고, 없으면 곡을 기다리다 나갈 예약을 건다.
 * restoring 은 세션 복원을 시작할 때 부른다(디스코드는 "불러오는 중"을 먼저 답한다).
 * 텍스트 채널을 주지 않으면(대시보드) 서버의 전용 채널을 쓴다.
 * go는 비동기 대기(기동 복원, 채널 조회)가 끝난 뒤, 첫 상태 변경 전에 하는 확인이다. 예외를 던지면 아무것도 바꾸지 않는다(대시보드: 세션 종료).
 * 남은 플레이어를 정리하는 대기 뒤, 새 플레이어를 만들기 직전에 한 번 더 부른다(그때 던지면 남은 플레이어를 정리한 것만 반영된다).
 * 종료가 시작됐으면 플레이어를 만들기 전에 bot-shutting-down 으로 거절한다. 만든 뒤에는 음성 연결이 막혀(player/voice-link) 실패 경로로 세션을 남기고 정리한다
 */
async function join(bot: { players: Pick<PlayerSeats, "get" | "set"> }, { guild, member, textChannel = null }: JoinRequest, { restoring, go }: { restoring?: () => Promise<unknown>; go?: () => void } = {}): Promise<JoinResult> {
  const channel = member.voice.channel;
  const refused = refusal(guild, channel);
  if (refused || !channel) return { kind: "refused", code: refused ?? "must-be-in-voice" };
  return attach(bot, guild, channel, textChannel, { restoring, go });
}

/** 지정한 채널에 붙인다(24/7 상주). 요청한 사용자가 없어 봇의 권한과 다른 채널 접속 여부만 본다. 텍스트 채널을 주지 않으면 서버의 전용 채널. go 는 join 과 같다 */
async function joinChannel(bot: { players: Pick<PlayerSeats, "get" | "set"> }, { guild, channel, textChannel = null }: { guild: Guild; channel: VoiceBasedChannel; textChannel?: GuildTextBasedChannel | null }, { go }: { go?: () => void } = {}): Promise<JoinResult> {
  const refused = refusal(guild, channel);
  if (refused) return { kind: "refused", code: refused };
  return attach(bot, guild, channel, textChannel, { go });
}

async function attach(bot: { players: Pick<PlayerSeats, "get" | "set"> }, guild: Guild, channel: VoiceBasedChannel, textChannel: GuildTextBasedChannel | null, { restoring, go }: { restoring?: () => Promise<unknown>; go?: () => void } = {}): Promise<JoinResult> {
  // 기동 복원이 아직 이 서버에 오지 않았으면 먼저 복원한다. 같은 세션을 기동 복원과 둘이 되살리지 않게
  await waitForRestore(guild.id);

  // 이미 붙어 있음(붙는 중, 끊겨 재연결하는 중 포함)
  const existing = bot.players.get(guild.id);
  if (existing?.voice.isAlive()) return { kind: "already", player: existing };

  // 텍스트 채널을 먼저 찾는다(비동기 대기를 모두 상태 변경 전에 끝낸다)
  const text = textChannel ?? (await resolveFallbackTextChannel(guild));
  go?.();
  if (isShuttingDown()) return SHUTTING_DOWN;

  // /leave 나 종료가 저장해 둔 세션
  const saved = sessions().load(guild.id);

  // 붙지 않은 채 남은 플레이어(붙기 실패 등)는 정리하고 새로 만든다. 그냥 버리면 타이머, 상태 동기화, 캐시 퇴거 보호가
  // 걸린 채 새 플레이어와 같은 서버 키를 두고 경쟁한다. 저장한 세션은 그대로 두어 아래에서 복원한다
  if (existing) {
    await existing.dispose({ reason: "봇 부르기 교체", session: "keep", end: "replaced" });
    go?.();
    if (isShuttingDown()) return SHUTTING_DOWN;
  }

  const player = ensurePlayer(bot, { guild, textChannel: text, voiceChannel: channel });
  // 지금 곡이 없고 대기열만 있는 세션도 복원한다(첫 곡에서 멈춘 채)
  if (hasTracks(saved)) {
    await restoring?.();
    const restored = await restore(player, saved);
    // 저장 위치가 마지막 곡의 끝이라 틀 곡이 남지 않았다(복원은 붙지 않았다). 보통의 참가로
    if (restored) return restored;
  }

  return connectFresh(player);
}

// 복원할 것 없이 붙는다. 못 붙으면 플레이어를 정리한다(세션은 남긴다). 실패 원인은 음성 연결 쪽이 로그에 남긴다
async function connectFresh(player: Player): Promise<JoinResult> {
  try {
    await player.voice.connect();
  } catch (error) {
    await player.dispose({ reason: "음성 채널 접속 실패", session: "keep", end: "connect-failed" });
    return codeOf(error) === "bot-shutting-down" ? SHUTTING_DOWN : { kind: "refused", code: "voice-failed" };
  }
  waitEmpty(player);
  return { kind: "joined", player };
}

const SHUTTING_DOWN = { kind: "refused", code: "bot-shutting-down" } as const satisfies JoinResult;

// 부를 수 없는 까닭. 부를 수 있으면 null
function refusal(guild: Guild, channel: VoiceBasedChannel | null) {
  if (!channel) return "must-be-in-voice" as const;
  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return "permission-voice" as const;
  // 다른 채널에서 쓰는 봇은 옮기지 않는다(옮기려면 디스코드에서 드래그해서 옮긴다)
  const botChannel = me?.voice?.channel;
  if (botChannel && botChannel.id !== channel.id) return "bot-in-other-voice" as const;
  return null;
}

// 저장한 세션을 복원한다. 채널 알림은 내지 않는다(진입점이 결과를 알린다). 틀 곡이 남지 않았으면(empty) null: 부르는 쪽이 보통의 참가로 잇는다
async function restore(player: Player, saved: RestoredSession): Promise<JoinResult | null> {
  try {
    const outcome = await player.persistence.restoreFromState(saved, { announce: false });
    if (outcome === "empty") return null;
    return { kind: "restored", player, track: outcome === "restored" || outcome === "parked" ? player.currentTrack : null, left: player.queue.length, parked: outcome === "parked" };
  } catch (error) {
    if (codeOf(error) === "bot-shutting-down") {
      await player.dispose({ reason: "종료 중", session: "keep", end: "connect-failed" });
      return SHUTTING_DOWN;
    }
    log.error("세션 복원 실패:", messageOf(error));
    await player.dispose({ reason: "세션 복원 실패", session: "keep", end: "restore-failed" });
    return { kind: "restore-error" };
  }
}

// 되살릴 곡이 있는 세션인가
const hasTracks = (saved: RestoredSession | null): saved is RestoredSession => Boolean(saved && (saved.current || saved.queue.length > 0));

// 틀 것 없이 들어왔다. 곡이 끝났을 때처럼 잠시 뒤 나가고, 패널에도 그렇게 적는다
function waitEmpty(player: Player) {
  player.showIdleVoiceStatus();
  player.idle.scheduleEmpty("곡 없이 대기");
  playerEvents.ended(player, "joined").catch((error) => log.warn(`참가 뒤 패널 갱신 실패: ${messageOf(error)}`));
}

export { join, joinChannel };
export type { JoinResult };
