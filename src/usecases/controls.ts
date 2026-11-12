// 재생 조작 코어. 진입점(명령, 버튼, 대시보드)은 이것을 부르고, 결과의 code 를 자기 매체의 말로 옮긴다(ui/control-messages).
// 전제 조건(플레이어가 있나, 권한, 곡, 대기열)은 여기서 한 번, 같은 순서로 본다. 조작 뒤 패널 고치기도 여기서 알린다.
//
// 결과: { ok: true, ...사실 } | { ok: false, code, …값 }. code 는 문제 목록(rules/problems)의 코드
//   공통 code: no-song(플레이어나 틀고 있는 곡이 없다), 권한 판정이 막은 까닭의 코드(must-dj 등)
//
// actor: 누가 시켰나. 디스코드 멤버(대시보드도 그 서버의 멤버로 조작한다)

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "control" });
import * as perm from "./permissions.ts";
import { bestEffort } from "../infra/best-effort.ts";
import * as playerEvents from "../player/events.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { VOLUME_MAX } from "../rules/limits.ts";
import { canGoBack } from "../rules/controls.ts";
import * as guildSettings from "../store/guild-settings.ts";
import * as genreConfig from "../config/genres.ts";
import type { Guild, GuildMember } from "discord.js";
import { leaveLingeringVoice, LEFT_BY } from "../player/voice-leave.ts";
import type { Player } from "../player/player.ts";
import type { QueuedTrack } from "../player/track.ts";
import type { PlayerRegistry } from "../player/registry.ts";
import type { Loop } from "../rules/loop-cycle.ts";
import type { PermissionDenied } from "./permissions.ts";
import type { Code, NeedsParams, ParamsOf, Problem } from "../rules/problems.ts";
import { clearSeat } from "./stay.ts";
import { seatedIn } from "../player/idle-leave.ts";

/** 누가 시켰나: 디스코드 멤버 */
type Actor = { member: GuildMember };
/** 거절: 문제의 코드와 그 문장에 드는 값(길이 넘침은 durationMs, 위치 틀림은 size, 모르는 장르는 genre) */
type Refusal = { ok: false } & Problem;
/** 이 서버에 플레이어가 없을 수 있다 */
type MaybePlayer = Player | null | undefined;
/** 권한 판정. 막으면 그 까닭 */
type Check = (member: GuildMember, player: Player) => Promise<PermissionDenied | null>;

/** 거절. 그 코드의 문장에 드는 값을 함께(rules/problems 의 params) */
const fail = <C extends Code>(code: C, ...[params]: NeedsParams<C> extends true ? [params: ParamsOf<C>] : [params?: ParamsOf<C>]): Refusal => ({ ok: false, code, ...params }) as Refusal;
// 해낸 결과. 사실을 싣는다
const done = <T extends object>(facts: T) => ({ ok: true as const, ...facts });

// 조작 뒤 패널을 지금 상태로 다시 그린다. 기다리지 않는다(응답이 패널 REST, 썸네일 확인을 기다리지 않게. 그리기는 패널이 서버마다 순서대로 한다).
// 패널을 갱신하지 못해도 조작은 된 것이다
const refresh = (player: Player) => playerEvents.refresh(player).catch((error) => log.warn(`조작 뒤 패널 갱신 실패: ${messageOf(error)}`));

// 권한이 있나. 막히면 실패 결과, 지나가면 null. 플레이어가 있는지는 부르는 쪽이 먼저 본다
async function permitted(player: Player, actor: Actor, check: Check = perm.checkControl) {
  const permission = await check(actor.member, player);
  return permission ? fail(permission) : null;
}

// 수는 진입점이 받은 값 그대로 온다(없거나 수가 아닐 수 있다). 0 이상 size 미만의 정수인가
const isIndex = (i: unknown, size: number): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < size;

// 권한을 보고 틀고 있는 곡을 잡는다. 막히면 거절, 지나가면 그 곡.
// onTrack(대기열 ID)을 주면 지금 곡이 그 곡일 때만 지난다. 대시보드가 보던 곡이 그 사이 넘어갔으면 다음 곡에 조작이 가지 않게 거절한다
async function permittedTrack(player: Player, actor: Actor, check?: Check, onTrack?: number) {
  const blocked = await permitted(player, actor, check);
  if (blocked) return { blocked };
  const track = player.currentTrack;
  if (!track) return { blocked: fail("no-song") };
  if (onTrack !== undefined && track.entry !== onTrack) return { blocked: fail("track-changed") };
  return { track };
}

/** 지금 곡이 이 대기열 ID의 곡일 때만(대시보드). 없으면 확인하지 않는다 */
type OnTrack = { onTrack?: number };

/**
 * 사람의 멈춤을 뒤집는다. 억제 사유(서버 음소거, 스테이지 청중, 혼자 남음)는 보지 않는다:
 * 그 사유로 소리가 이미 멈춰 있어도 일시정지하면 사유가 풀려도 멈춘 채로, 일시정지를 풀면 사유가 풀리는 순간 이어 튼다.
 * heldBy: 지금 소리를 함께 멈추고 있는 억제 사유(결과 안내가 그 사유가 풀린 뒤를 말한다)
 */
async function pause(player: MaybePlayer, actor: Actor, { onAccepted }: { onAccepted?: () => unknown } = {}) {
  if (!player) return fail("no-song");
  const { blocked, track } = await permittedTrack(player, actor);
  if (!track) return blocked;
  // 실패로 일시정지해 둔 곡이면 ▶는 그 위치부터 다시 연다(일시정지만 풀면 열린 소리가 없어 아무 일도 없다).
  // 곡을 여는 데 몇 초 걸려 onAccepted(응답)를 먼저 부르고, 답한 사이 곡이 바뀌었거나 정리됐으면 다시 열지 않는다
  if (player.parked) {
    await onAccepted?.();
    if (!player.currentTrack) return fail("no-song");
    if (player.currentTrack !== track) return fail("track-changed");
    await player.retryParked();
    return done({ userPaused: player.pause.userPaused, heldBy: player.pause.heldBy, track });
  }
  player.pause.setUser(!player.pause.userPaused);
  // 휴면 중인 곡이면 스트림을 다시 연다. 몇 초 걸릴 수 있어 기다리지 않고 답한다(여는 동안에도 화면은 곡을 보인다)
  if (player.resting) void player.wake().catch((error: unknown) => log.warn(`휴면 스트림 다시 열기 실패: ${messageOf(error)}`));
  void refresh(player);
  return done({ userPaused: player.pause.userPaused, heldBy: player.pause.heldBy, track });
}

/**
 * 지금 곡을 건너뛴다. 한곡 반복 중이면 처음부터 다시(restarted).
 * 대기열이 비었어도 거절하지 않는다. 그 뒤는 곡이 끝났을 때와 같다(자동재생이 켜져 있으면 다음 곡을 선택한다)
 */
async function skip(player: MaybePlayer, actor: Actor, { onTrack }: OnTrack = {}) {
  if (!player) return fail("no-song");
  const { blocked, track } = await permittedTrack(player, actor, perm.checkSkip, onTrack);
  if (!track) return blocked;
  const restarted = player.loop === "track";
  if (!player.skip()) return fail("switch-failed");
  if (!restarted && player.currentTrack) void refresh(player);
  return done({ track, restarted });
}

/**
 * 정리를 시작해 둔 채 답한다. 정리의 동기 부분(레지스트리에서 빠짐, 대기열 비움)은 work 를 만들 때 이미 끝나, 답을 기다리는 사이 다른 명령이 정리 전의 플레이어를 보지 않는다.
 * 정리의 실패는 곧바로 잡아 warn 으로 남긴다(답을 기다리는 사이 처리되지 않은 거부가 되지 않게). 답이 실패해도 정리는 끝까지 기다린 뒤 그 오류를 올린다
 */
async function answerDuring<T>(work: Promise<unknown>, what: string, facts: T, onAccepted: ((facts: T) => unknown) | undefined) {
  const ending = work.catch((error: unknown) => log.warn(`${what} 실패: ${messageOf(error)}`));
  try {
    await onAccepted?.(facts);
  } finally {
    await ending;
  }
}

/** 정리를 시작한 뒤, 끝을 기다리기 전에 부른다(응답). 받는 것은 돌려줄 결과와 같다 */
type Accepting<T> = { onAccepted?: (facts: T) => unknown };

/** 멈추고 대기열을 비우고 나간다. 세션도 삭제한다 */
async function stop(player: MaybePlayer, actor: Actor, { onAccepted }: Accepting<{ track: QueuedTrack | null; cleared: number; stayed: boolean }> = {}) {
  if (!player) return fail("no-song");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  const track = player.currentTrack;
  const cleared = player.queue.length;
  // 24/7 자리에서는 대기열만 비우고 남는다. 여는 중이면 그 곡이 정지 뒤에 틀어지지 않게 거절한다
  if (seatedIn(player.guild?.id ?? "", player.voiceChannel?.id)) {
    if (player.isPlayStarting) return fail("still-starting");
    log.info(`정지(상주 모드라 채널에 남음): ${player._trackLabel()} | 대기열 ${cleared}곡 비움`);
    const facts = { track, cleared, stayed: true };
    await answerDuring(player.stopStaying(), "상주 모드 정지", facts, onAccepted);
    return done(facts);
  }
  log.info(`정지: ${player._trackLabel()} | 대기열 ${cleared}곡 비움`);
  const facts = { track, cleared, stayed: false };
  await answerDuring(player.dispose({ reason: "정지", session: "remove", panel: "stop", end: "stop" }), "정지", facts, onAccepted);
  return done(facts);
}

/** 이전 곡으로. 한곡 반복 중이면 지금 곡을 처음부터(restarted). track 은 되돌아간 곡(처음부터면 지금 곡) */
async function previous(player: MaybePlayer, actor: Actor, { onTrack }: OnTrack = {}) {
  if (!player) return fail("no-song");
  const { blocked, track } = await permittedTrack(player, actor, undefined, onTrack);
  if (!track) return blocked;
  if (!canGoBack({ history: player.previousTracks.length, loop: player.loop })) return fail("no-previous");
  const restarted = player._restartsOnPrevious();
  if (!player.previous()) return fail("switch-failed");
  // 되돌아간 곡은 대기열 맨 앞에 선다(trackState.rewind)
  return done({ restarted, track: restarted ? track : (player.queue[0] ?? track) });
}

/**
 * 곡 안의 위치로. reason 은 로그에 남는 원인(seek, replay, highlight, dashboard).
 * 곡을 여는 중이면 거절한다. onAccepted: 전제 조건을 지난 뒤, 오래 걸리는 작업 전에 부른다(응답 미루기 등).
 * 곡 길이를 넘으면 거절한다(beyond-end, durationMs 를 싣는다)
 */
async function seek(player: MaybePlayer, actor: Actor, ms: number, { reason = "seek", onAccepted, onTrack }: SeekOptions = {}) {
  if (!player) return fail("no-song");
  const { blocked, track } = await permittedTrack(player, actor, undefined, onTrack);
  if (!track) return blocked;
  const unseekable = seekBlocked(player);
  if (unseekable) return unseekable;
  const durationMs = (Number(track.duration) || 0) * 1000;
  if (durationMs > 0 && ms >= durationMs) return fail("beyond-end", { durationMs });
  await onAccepted?.();
  await player.seek(ms, reason);
  void refresh(player);
  return done({ ms, track });
}

/** 위치 이동. reason 은 로그에 남는 원인, onAccepted 는 전제 조건을 지난 뒤 부른다 */
type SeekOptions = { reason?: string; onAccepted?: () => unknown } & OnTrack;

function seekBlocked(player: Player) {
  // 라이브에는 실시간밖에 없다. 옮길 위치가 없다
  if (player.isLive) return fail("live-no-seek");
  // 여는 중에는 옮길 곡이 아직 자리 잡지 않았다
  if (player.isPlayStarting) return fail("still-starting");
  // 무음을 내보내며 멈추는 중이면 곡이 곧 바뀐다(옮기면 새 소리가 무음을 덮어 멈춤을 무른다)
  if (player.isStopping) return fail("track-changed");
  return null;
}

/** 처음부터 다시 */
const replay = (player: MaybePlayer, actor: Actor, opts: SeekOptions = {}) => seek(player, actor, 0, { ...opts, reason: "replay" });

/** SponsorBlock 하이라이트 지점으로 */
async function highlight(player: MaybePlayer, actor: Actor, opts: SeekOptions = {}) {
  if (!player) return fail("no-song");
  const { blocked, track } = await permittedTrack(player, actor, undefined, opts.onTrack);
  if (!track) return blocked;
  const unseekable = seekBlocked(player);
  if (unseekable) return unseekable;
  const at = player.sponsor?.highlightAt;
  if (at === null || at === undefined) return fail("no-highlight");
  return seek(player, actor, Math.max(0, Math.floor(at * 1000)), { ...opts, reason: "highlight" });
}

/** 볼륨(0 ~ VOLUME_MAX 정수). 소리는 바로 바뀐다. 로그와 패널은 잇단 변경이 멈춘 뒤 한 번, 그때 바뀌었으면 settled(처음 값, 마지막 값)도 */
async function volume(player: MaybePlayer, actor: Actor, level: unknown, { settled }: { settled?: Settled } = {}) {
  if (!player) return fail("no-song");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  if (!isIndex(level, VOLUME_MAX + 1)) return fail("bad-volume");
  const before = player.volume;
  const applied = player.setVolume(level) ?? level;
  settleVolume(player, before, settled);
  return done({ before, level: applied });
}

// 대시보드는 슬라이더를 드래그하는 동안 볼륨을 잇달아 보낸다. 요청마다 적고 패널을 고치면 로그가 넘치고 디스코드 수정이 밀린다
const VOLUME_SETTLE_MS = 1000;
/** 볼륨이 멈춘 뒤 부른다(대시보드가 디스코드 패널 채널에 알린다) */
type Settled = (from: number, to: number) => void;
const settling = new WeakMap<Player, { from: number; timer?: NodeJS.Timeout; settled?: Settled }>(); // settled 는 마지막에 받은 것

const saveServerVolume = async (player: Player) => guildSettings.saveVolume(player.guild.id, player.volume);

function settleVolume(player: Player, before: number, settled: Settled | undefined) {
  const s = settling.get(player) ?? { from: before };
  if (settled) s.settled = settled;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    settling.delete(player);
    const changed = s.from !== player.volume;
    if (changed) {
      log.info(`볼륨: ${s.from}% → ${player.volume}%`);
      s.settled?.(s.from, player.volume);
    }
    bestEffort(log, refresh(player), "볼륨 뒤 패널 갱신");
    // 정지했다가 다시 틀어도 이 볼륨으로 시작한다
    if (changed) bestEffort(log, saveServerVolume(player), "서버 볼륨 저장");
  }, VOLUME_SETTLE_MS);
  s.timer.unref?.();
  settling.set(player, s);
}

const isLoop = (mode: unknown): mode is Loop => mode === false || mode === "track" || mode === "queue";

/** 반복 모드. mode: false(끔), "track", "queue". 진입점이 받은 값 그대로 온다 */
async function loop(player: MaybePlayer, actor: Actor, mode: unknown) {
  if (!player) return fail("no-song");
  const { blocked, track } = await permittedTrack(player, actor);
  if (!track) return blocked;
  if (!isLoop(mode)) return fail("bad-loop-mode");
  // 끝이 없는 것은 반복할 수 없다. 끄는 것은 언제나 통한다
  if (mode && player.hasLiveTrack()) return fail("live-no-loop");
  player.setLoop(mode);
  void refresh(player);
  return done({ mode, track });
}

/** 대기열 섞기 */
async function shuffle(player: MaybePlayer, actor: Actor) {
  if (!player) return fail("no-song");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  if (player.queue.length < 2) return fail("too-few-to-shuffle");
  player.shuffleQueue();
  void refresh(player);
  return done({ count: player.queue.length });
}

/** 대기열에서 한 곡 빼기. index 는 0부터. 자기가 넣은 곡은 DJ 가 아니어도 뺄 수 있어 권한은 곡을 보고 판정한다 */
async function remove(player: MaybePlayer, actor: Actor, index: unknown) {
  if (!player) return fail("no-song");
  if (player.queue.length === 0) return fail("queue-empty");
  if (!isIndex(index, player.queue.length)) return fail("bad-position", { size: player.queue.length });
  const target = player.queue[index];
  const blocked = await permitted(player, actor, (member) => perm.checkRemoveTrack(member, target));
  if (blocked) return blocked;
  // 권한을 기다린 사이 대기열이 바뀌었을 수 있어 권한을 본 그 곡을 다시 찾는다. 같은 자리의 다른 곡을 빼지 않는다
  const at = player.queue.indexOf(target);
  if (at < 0) return fail("entry-gone");
  const track = player.removeFromQueue(at);
  void refresh(player);
  return done({ track, left: player.queue.length });
}

/** 대기열 안에서 옮기기. from, to 는 0부터 */
async function move(player: MaybePlayer, actor: Actor, from: unknown, to: unknown) {
  if (!player) return fail("no-song");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  const size = player.queue.length;
  if (size < 2) return fail("too-few-to-move");
  if (!isIndex(from, size) || !isIndex(to, size)) return fail("bad-position", { size });
  if (from === to) return fail("same-position");
  const track = player.queue[from];
  player.moveInQueue(from, to);
  void refresh(player);
  return done({ track, from, to });
}

/** 대기열 ID로 한 곡 빼기(대시보드). 보던 화면이 오래돼도 그 곡을 뺀다. 그 사이 빠졌으면 거절 */
async function removeEntry(player: MaybePlayer, actor: Actor, entry: number) {
  if (!player) return fail("no-song");
  const at = () => player.queue.findIndex((t) => t.entry === entry);
  const found = player.queue[at()];
  if (!found) return fail("entry-gone");
  const blocked = await permitted(player, actor, (member) => perm.checkRemoveTrack(member, found));
  if (blocked) return blocked;
  // 권한을 기다린 사이 위치가 바뀌었을 수 있어 다시 찾는다
  const index = at();
  if (index < 0) return fail("entry-gone");
  const track = player.removeFromQueue(index);
  void refresh(player);
  return done({ track, left: player.queue.length });
}

/** 대기열 ID로 옮기기(대시보드). entry 를 before 앞에, before 가 null 이면 맨 끝으로. 그 사이 빠졌으면 거절 */
async function moveEntry(player: MaybePlayer, actor: Actor, entry: number, before: number | null) {
  if (!player) return fail("no-song");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  const size = player.queue.length;
  if (size < 2) return fail("too-few-to-move");
  const indexOf = (e: number) => player.queue.findIndex((t) => t.entry === e);
  const from = indexOf(entry);
  const anchor = before === null ? size : indexOf(before);
  if (from < 0 || anchor < 0) return fail("entry-gone");
  // 앞에서 빼면 뒤쪽 위치가 하나씩 당겨진다
  const to = from < anchor ? anchor - 1 : anchor;
  if (from === to) return fail("same-position");
  const track = player.queue[from];
  player.moveInQueue(from, to);
  void refresh(player);
  return done({ track, from, to });
}

/** 대기열 비우기(지금 곡은 그대로) */
async function clear(player: MaybePlayer, actor: Actor) {
  if (!player) return fail("no-song");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  const count = player.queue.length;
  if (count === 0) return fail("queue-empty");
  player.clearQueue();
  void refresh(player);
  return done({ count, track: player.currentTrack });
}

/** 대기열 ID 의 곡으로 바로 넘어간다. 한 곡 반복 중에도 그 곡으로 간다. 그 곡이 대기열에 없으면 entry-gone */
async function jump(player: MaybePlayer, actor: Actor, entry: number) {
  if (!player) return fail("no-song");
  const blocked = await permitted(player, actor);
  if (blocked) return blocked;
  // 권한 확인을 기다린 뒤에 찾는다(그사이 위치가 바뀌었을 수 있다)
  const index = player.queue.findIndex((t) => t.entry === entry);
  if (index < 0) return fail("entry-gone");
  const track = player.queue[index];
  player.moveInQueue(index, 0);
  if (!player.skip("jump")) {
    player.moveInQueue(0, index);
    return fail("switch-failed");
  }
  return done({ track });
}

/**
 * 자동재생을 시킬 수 있나. 재생 조작이라 DJ 계층, 봇이 쉬면 소환할 수 있어야 한다(켜면 그 자리에서 붙는다).
 * 장르 메뉴를 표시하기 전에 진입점이 본다. 막히면 거절, 지나가면 null
 */
async function autoplayBlocked(actor: Actor) {
  const permission = await autoplayDenied(actor.member);
  return permission ? fail(permission) : null;
}

/** 자동재생을 시킬 수 없는 까닭(/help 의 "지금은"도 쓴다). 되면 null */
async function autoplayDenied(member: GuildMember) {
  return (await perm.checkControl(member)) || perm.checkSummon(member);
}

// 켤 장르를 쓸 수 없으면 거절 결과를 반환한다(없는 장르, 키가 빠진 장르). 끄기는 null이다
function genreRefusal(genre: string | false) {
  if (genre === false) return null;
  if (!genreConfig.genres().genres[genre]) return fail("unknown-genre", { genre });
  const missing = genreConfig.unusableGenre(genre);
  return missing ? fail("genre-unusable", { genre: genreConfig.labelOf(genre), keys: missing.join(", ") }) : null;
}

/** 자동재생 켜기, 끄기. create 는 켤 때 플레이어가 없으면 만든다. onAccepted 는 설정을 바꾼 뒤, 첫 곡을 선택하기 전에 부른다(응답) */
/** go: 판정 뒤, 첫 상태 변경(플레이어 생성, 설정 변경) 전에 하는 확인이다. 예외를 던지면 아무것도 바꾸지 않는다(대시보드: 세션 종료) */
type AutoplayOptions = { create?: () => Player | Promise<Player>; onAccepted?: () => unknown; go?: () => void };

// 쉬던 플레이어를 음성에 먼저 붙인다. 첫 곡을 넣는 것은 DB 에 쓰므로, 붙지 못했을 때 앞 플레이어가 남긴 세션(/join 으로 이어 듣기)을 건드리지 않게. 붙지 못하면 플레이어를 버린다
// 붙었으면 null, 못 붙었으면 그 까닭(종료 중이면 bot-shutting-down)
async function joinIdle(target: Player) {
  if (target.connection) return null;
  try {
    await target.voice.connect();
    return null;
  } catch (error) {
    // VoiceLink.connect 가 실패 원인을 error 로 남기고 던졌다. 나간 것은 정리(dispose)가 남긴다
    await target.dispose({ reason: "음성 채널 접속 실패", session: "keep", end: "connect-failed" });
    return codeOf(error) === "bot-shutting-down" ? "bot-shutting-down" : "voice-failed";
  }
}

/**
 * 자동재생. genre 로 켜고 false 로 끈다. 플레이어는 켤 때만 만든다(장르를 선택한 뒤에: 메뉴만 닫으면 아무것도 남지 않게).
 * 켰는데 틀고 있지 않으면 그 자리에서 첫 곡을 선택해 튼다(started). 틀고 있으면 지금 곡이 끝난 뒤에 이어진다
 */
async function autoplay(player: MaybePlayer, actor: Actor, genre: string | false, { create, onAccepted, go }: AutoplayOptions = {}) {
  const blocked = (await autoplayBlocked(actor)) ?? genreRefusal(genre);
  if (blocked) return blocked;
  go?.();
  const target = player ?? (genre === false ? null : await create?.());
  if (!target) return fail("no-song");
  // 켰는데 틀고 있지 않으면 그 자리에서 첫 곡을 튼다
  const starts = genre !== false && !target.currentTrack;
  const refused = starts ? await joinIdle(target) : null;
  if (refused) return fail(refused);
  target.setAutoplay(genre);
  await answerThenStart(target, starts, onAccepted);
  return done({ genre, started: starts });
}

/**
 * 켠 뒤: 답하고(onAccepted), 틀고 있지 않았으면 첫 곡을 선택한다. 틀고 있었으면 패널만 갱신한다.
 * 답이 실패해도 첫 곡은 선택한다(봇이 음성에 붙은 채 아무것도 틀지 않게). 둘 다 실패하면 첫 곡의 오류는 warn 으로 남기고 답의 오류를 올린다
 */
async function answerThenStart(target: Player, starts: boolean, onAccepted: (() => unknown) | undefined) {
  let answerError: { error: unknown } | null = null;
  try {
    await onAccepted?.();
  } catch (error) {
    answerError = { error };
  }
  if (starts) {
    try {
      await target.handleAutoplay();
    } catch (error) {
      if (!answerError) throw error;
      log.warn(`자동재생 첫 곡 선택 실패: ${messageOf(error)}`);
    }
  } else void refresh(target);
  if (answerError) throw answerError.error;
}

/**
 * 나가기. 세션을 남겨 /join 이 복구한다. 플레이어가 없어도 봇이 음성에 남아 있으면 나간다(left: "voice-only").
 * 권한은 플레이어가 없어도 본다
 */
async function leave(guild: Guild, actor: Actor, players: Pick<PlayerRegistry, "get">, { onAccepted, onLeaving }: Accepting<{ left: "player"; track: QueuedTrack | null; saved: { queue: number; positionSec: number }; stayOff: boolean }> & { onLeaving?: () => unknown } = {}) {
  const permission = await perm.checkControl(actor.member);
  if (permission) return fail(permission);
  // 24/7 상주 모드도 함께 끈다(켜고 끄는 권한과 같은 DJ 조작이라 위에서 이미 확인했다). 플레이어를 정리하기 전에 먼저 해제한다(종료 알림을 받은 StayKeeper가 다시 접속하지 않게)
  const seated = clearSeat(guild, actor.member);
  const player = players.get(guild.id);
  if (!player) {
    // StayKeeper가 재접속을 기다리는 중이면 봇이 음성 채널에 없다. 상주 모드만 끈 것이다
    if (!guild.members.me?.voice?.channel) return seated ? done({ left: "seat-only" as const, stayOff: true }) : fail("no-song");
    // 나가기는 게이트웨이를 기다리고 REST 로 넘어가 몇 초 걸릴 수 있어 먼저 답한다(onLeaving)
    await onLeaving?.();
    const how = await leaveLingeringVoice(guild, players);
    if (how === "superseded") return fail("leave-superseded");
    if (how === "failed") return fail("leave-failed");
    log.info(`플레이어 없이 남은 음성 채널에서 나감(${LEFT_BY[how]}): ${guild.name}`);
    return done({ left: "voice-only" as const, stayOff: seated });
  }
  const track = player.currentTrack;
  const saved = { queue: player.queue.length, positionSec: Math.floor((player.getCurrentTime?.() || 0) / 1000) };
  const facts = { left: "player" as const, track, saved, stayOff: seated };
  await answerDuring(player.dispose({ reason: "나가며 저장", session: "save", panel: track ? "leave" : "disconnected", end: "leave" }), "나가기", facts, onAccepted);
  return done(facts);
}

export type { Actor, Refusal };
export { VOLUME_SETTLE_MS, pause, skip, stop, previous, seek, replay, highlight, volume, loop, shuffle, remove, removeEntry, move, moveEntry, clear, jump, autoplayBlocked, autoplayDenied, autoplay, leave };
