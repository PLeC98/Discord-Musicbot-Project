// 재생 조작 코어. 입구(명령 · 버튼 · 대시보드)는 이것을 부르고, 결과의 code 를 자기 매체의 말로 옮긴다(ui/controlMessages).
// 전제 조건(플레이어가 있나 · 권한 · 곡 · 대기열)은 여기서 한 번, 같은 차례로 본다. 조작 뒤 패널 고치기도 여기서 알린다.
//
// 결과: { ok: true, ...사실 } | { ok: false, code, message? }
//   공통 code: no-player(이 서버에 플레이어가 없다) · no-permission(message: 권한 판정의 안내) · no-track(틀고 있는 곡이 없다)
//
// actor: 누가 시켰나. { member } 는 디스코드 멤버, { owner: true } 는 대시보드 운영자(권한 판정을 건너뛴다)

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "control" });
import * as perm from "./permissions.ts";
import * as playerEvents from "../player/events.ts";
import { messageOf } from "../rules/errorKind.ts";
import type { Guild, GuildMember } from "discord.js";
import type { MusicPlayer } from "../player/Player.ts";
import type { PlayerRegistry } from "../player/registry.ts";
import type { Loop } from "../player/trackState.ts";

/** 누가 시켰나. 디스코드 멤버, 또는 대시보드 운영자(권한 판정을 건너뛴다) */
type Actor = { member: GuildMember; owner?: undefined } | { owner: true; member?: undefined };
/** 거절. 길이 넘침은 durationMs, 자리 틀림은 size, 권한은 message 를 싣는다 */
type Refusal = { ok: false; code: string; message?: string; durationMs?: number; size?: number };
/** 이 서버에 플레이어가 없을 수 있다 */
type MaybePlayer = MusicPlayer | null | undefined;
/** 권한 판정. 막으면 안내 문장 */
type Check = (member: GuildMember, player: MusicPlayer) => Promise<string | null>;

const fail = (code: string, extra: Omit<Refusal, "ok" | "code"> = {}): Refusal => ({ ok: false, code, ...extra });
// 해낸 결과. 사실을 싣는다
const done = <T extends object>(facts: T) => ({ ok: true as const, ...facts });

// 조작 뒤 패널을 지금 상태로. 패널을 못 고쳐도 조작은 된 것이다
const refresh = (player: MusicPlayer) => playerEvents.refresh(player).catch((error) => log.warn(`조작 뒤 패널 갱신 실패: ${messageOf(error)}`));

// 권한이 있나. 막히면 실패 결과, 지나가면 null. 플레이어가 있는지는 부르는 쪽이 먼저 본다
async function permitted(player: MusicPlayer, actor: Actor, check: Check = perm.checkControl) {
  if (actor.owner) return null;
  const message = await check(actor.member, player);
  return message ? fail("no-permission", { message }) : null;
}

// 수는 입구가 받은 값 그대로 온다(없거나 수가 아닐 수 있다). 0 이상 size 미만의 정수인가
const isIndex = (i: unknown, size: number): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < size;

// 권한을 보고 틀고 있는 곡을 잡는다. 막히면 거절, 지나가면 그 곡
async function permittedTrack(player: MusicPlayer, actor: Actor, check?: Check) {
  const blocked = await permitted(player, actor, check);
  if (blocked) return { blocked };
  const track = player.currentTrack;
  return track ? { track } : { blocked: fail("no-track") };
}

/** 멈춤 · 재개를 뒤집는다 */
async function pause(player: MaybePlayer, actor: Actor) {
  if (!player) return fail("no-player");
  const { blocked, track } = await permittedTrack(player, actor);
  if (!track) return blocked;
  const resuming = player.paused;
  if (!(resuming ? player.resume() : player.pause())) return fail("failed");
  await refresh(player);
  return done({ paused: !resuming, track });
}

/**
 * 지금 곡을 건너뛴다. 한곡 반복 중이면 처음부터 다시(restarted).
 * 대기열이 비었으면 거절한다. 자동재생이 켜져 있으면 다음 곡을 자동재생이 고르므로 넘긴다
 */
async function skip(player: MaybePlayer, actor: Actor) {
  if (!player) return fail("no-player");
  const { blocked, track } = await permittedTrack(player, actor, perm.checkSkip);
  if (!track) return blocked;
  const restarted = player.loop === "track";
  if (player.queue.length === 0 && !restarted && !player.autoplay) return fail("nothing-to-skip");
  if (!player.skip()) return fail("skip-failed");
  if (!restarted && player.currentTrack) await refresh(player);
  return done({ track, restarted });
}

/** 멈추고 대기열을 비우고 나간다. 세션도 지운다 */
async function stop(player: MaybePlayer, actor: Actor, players: Pick<PlayerRegistry, "delete">) {
  if (!player) return fail("no-player");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  const track = player.currentTrack;
  const cleared = player.queue.length;
  player.stop();
  players.delete(player.guild.id);
  await playerEvents.ended(player, "stop").catch((error) => log.warn(`정지 뒤 패널 갱신 실패: ${messageOf(error)}`));
  return done({ track, cleared });
}

/** 이전 곡으로. 한곡 반복 중이면 지금 곡을 처음부터(restarted) */
async function previous(player: MaybePlayer, actor: Actor) {
  if (!player) return fail("no-player");
  const { blocked, track } = await permittedTrack(player, actor);
  if (!track) return blocked;
  const restarted = player.loop === "track";
  if (player.previousTracks.length === 0 && !restarted) return fail("no-previous");
  if (!player.previous()) return fail("previous-failed");
  return done({ restarted });
}

/**
 * 곡 안의 위치로. reason 은 로그에 남는 원인(seek · replay · highlight · dashboard).
 * 곡을 여는 중이면 거절한다. onAccepted: 전제 조건을 지난 뒤, 오래 걸리는 일 전에 부른다(응답 미루기 등).
 * 곡 길이를 넘으면 거절한다(beyond-end, durationMs 를 싣는다)
 */
async function seek(player: MaybePlayer, actor: Actor, ms: number, { reason = "seek", onAccepted }: SeekOptions = {}) {
  if (!player) return fail("no-player");
  const { blocked, track } = await permittedTrack(player, actor);
  if (!track) return blocked;
  const unseekable = seekBlocked(player);
  if (unseekable) return unseekable;
  const durationMs = (Number(track.duration) || 0) * 1000;
  if (durationMs > 0 && ms >= durationMs) return fail("beyond-end", { durationMs });
  await onAccepted?.();
  await player.seek(ms, reason);
  await refresh(player);
  return done({ ms, track });
}

/** 위치 이동. reason 은 로그에 남는 원인, onAccepted 는 전제 조건을 지난 뒤 부른다 */
type SeekOptions = { reason?: string; onAccepted?: () => unknown };

function seekBlocked(player: MusicPlayer) {
  // 라이브에는 실시간밖에 없다. 옮길 자리가 없다
  if (player.isLive) return fail("live-no-seek");
  // 여는 중에는 옮길 곡이 아직 자리 잡지 않았다
  if (player.isPlayStarting) return fail("starting");
  return null;
}

/** 처음부터 다시 */
const replay = (player: MaybePlayer, actor: Actor, opts: SeekOptions = {}) => seek(player, actor, 0, { ...opts, reason: "replay" });

/** SponsorBlock 하이라이트 지점으로 */
async function highlight(player: MaybePlayer, actor: Actor, opts: SeekOptions = {}) {
  if (!player) return fail("no-player");
  const { blocked, track } = await permittedTrack(player, actor);
  if (!track) return blocked;
  const unseekable = seekBlocked(player);
  if (unseekable) return unseekable;
  const at = player.sponsor?.highlightAt;
  if (at === null || at === undefined) return fail("no-highlight");
  return seek(player, actor, Math.max(0, Math.floor(at * 1000)), { ...opts, reason: "highlight" });
}

/** 음량(0 ~ 100 정수). 소리는 바로 바뀐다. 로그와 패널은 잇단 변경이 멈춘 뒤 한 번 */
async function volume(player: MaybePlayer, actor: Actor, level: unknown) {
  if (!player) return fail("no-player");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  if (!isIndex(level, 101)) return fail("bad-volume");
  const before = player.volume;
  const applied = player.setVolume(level) ?? level;
  settleVolume(player, before);
  return done({ before, level: applied });
}

// 대시보드는 끄는 동안 음량을 잇달아 보낸다. 요청마다 적고 패널을 고치면 로그가 넘치고 디스코드 수정이 밀린다
const VOLUME_SETTLE_MS = 400;
const settling = new WeakMap<MusicPlayer, { from: number; timer?: NodeJS.Timeout }>(); // player -> { from, timer }

function settleVolume(player: MusicPlayer, before: number) {
  const s = settling.get(player) ?? { from: before };
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    settling.delete(player);
    if (s.from !== player.volume) log.info(`볼륨: ${s.from}% → ${player.volume}%`);
    refresh(player);
  }, VOLUME_SETTLE_MS);
  s.timer.unref?.();
  settling.set(player, s);
}

const isLoop = (mode: unknown): mode is Loop => mode === false || mode === "track" || mode === "queue";

/** 반복 모드. mode: false(끔) · "track" · "queue". 입구가 받은 값 그대로 온다 */
async function loop(player: MaybePlayer, actor: Actor, mode: unknown) {
  if (!player) return fail("no-player");
  const { blocked, track } = await permittedTrack(player, actor);
  if (!track) return blocked;
  if (!isLoop(mode)) return fail("bad-loop-mode");
  // 끝이 없는 것은 반복할 수 없다. 끄는 것은 언제나 통한다
  if (mode && player.hasLiveTrack()) return fail("live-no-loop");
  player.setLoop(mode);
  await refresh(player);
  return done({ mode, track });
}

/** 반복 버튼의 다음 모드: 끔 → 한곡 → 대기열 → 끔 */
function nextLoopMode(current: Loop | "off"): Loop {
  if (current === false || current === "off") return "track";
  return current === "track" ? "queue" : false;
}

/** 대기열 섞기 */
async function shuffle(player: MaybePlayer, actor: Actor) {
  if (!player) return fail("no-player");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  if (player.queue.length < 2) return fail("too-few-to-shuffle");
  player.shuffleQueue();
  await refresh(player);
  return done({ count: player.queue.length });
}

/** 대기열에서 한 곡 빼기. index 는 0부터. 자기가 넣은 곡은 DJ 가 아니어도 뺄 수 있어 권한은 곡을 보고 판정한다 */
async function remove(player: MaybePlayer, actor: Actor, index: unknown) {
  if (!player) return fail("no-player");
  if (player.queue.length === 0) return fail("queue-empty");
  if (!isIndex(index, player.queue.length)) return fail("bad-position", { size: player.queue.length });
  const blocked = await permitted(player, actor, (member) => perm.checkRemoveTrack(member, player.queue[index]));
  if (blocked) return blocked;
  const track = player.removeFromQueue(index);
  if (!track) return fail("bad-position", { size: player.queue.length }); // 위에서 본 자리라 늘 있다
  await refresh(player);
  return done({ track, left: player.queue.length });
}

/** 대기열 안에서 옮기기. from · to 는 0부터 */
async function move(player: MaybePlayer, actor: Actor, from: unknown, to: unknown) {
  if (!player) return fail("no-player");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  const size = player.queue.length;
  if (size < 2) return fail("too-few-to-move");
  if (!isIndex(from, size) || !isIndex(to, size)) return fail("bad-position", { size });
  if (from === to) return fail("same-position");
  const track = player.queue[from];
  player.moveInQueue(from, to);
  await refresh(player);
  return done({ track, from, to });
}

/** 대기열 비우기(지금 곡은 그대로) */
async function clear(player: MaybePlayer, actor: Actor) {
  if (!player) return fail("no-player");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  const count = player.queue.length;
  if (count === 0) return fail("queue-empty");
  player.clearQueue();
  await refresh(player);
  return done({ count, track: player.currentTrack });
}

/** 대기열의 한 곡으로 바로 넘어간다. 한곡 반복 중에도 그 곡으로 간다 */
async function jump(player: MaybePlayer, actor: Actor, index: unknown) {
  if (!player) return fail("no-player");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  if (!isIndex(index, player.queue.length)) return fail("bad-position", { size: player.queue.length });
  const track = player.queue[index];
  player.moveInQueue(index, 0);
  if (!player.skip("jump")) {
    player.moveInQueue(0, index);
    return fail("jump-failed");
  }
  return done({ track });
}

/**
 * 나가기. 세션을 남겨 /join 이 복구한다. 플레이어가 없어도 봇이 음성에 남아 있으면 나간다(left: "voice-only").
 * 권한은 플레이어가 없어도 본다
 */
async function leave(guild: Guild, actor: Actor, players: Pick<PlayerRegistry, "get" | "delete">) {
  if (!actor.owner) {
    const message = await perm.checkControl(actor.member);
    if (message) return fail("no-permission", { message });
  }
  const player = players.get(guild.id);
  if (!player) {
    if (!guild.members.me?.voice?.channel) return fail("no-player");
    await guild.members.me.voice.disconnect();
    return done({ left: "voice-only" as const });
  }
  const track = player.currentTrack;
  const saved = { queue: player.queue.length, positionSec: Math.floor((player.getCurrentTime?.() || 0) / 1000) };
  await player.leaveAndSave();
  players.delete(guild.id);
  await playerEvents.ended(player, track ? "leave" : "disconnected").catch((error) => log.warn(`나간 뒤 패널 갱신 실패: ${messageOf(error)}`));
  return done({ left: "player" as const, track, saved });
}

export type { Actor };
export { VOLUME_SETTLE_MS, pause, skip, stop, previous, seek, replay, highlight, volume, loop, nextLoopMode, shuffle, remove, move, clear, jump, leave };
