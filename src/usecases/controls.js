"use strict";

// 재생 조작 코어. 입구(명령 · 버튼 · 대시보드)는 이것을 부르고, 결과의 code 를 자기 매체의 말로 옮긴다(ui/controlMessages).
// 전제 조건(플레이어가 있나 · 권한 · 곡 · 대기열)은 여기서 한 번, 같은 차례로 본다. 조작 뒤 패널 고치기도 여기서 알린다.
//
// 결과: { ok: true, ...사실 } | { ok: false, code, message? }
//   공통 code: no-player(이 서버에 플레이어가 없다) · no-permission(message: 권한 판정의 안내) · no-track(틀고 있는 곡이 없다)
//
// actor: 누가 시켰나. { member } 는 디스코드 멤버, { owner: true } 는 대시보드 운영자(권한 판정을 건너뛴다)

const log = require("../infra/log/logger").child({ category: "control" });
const perm = require("./permissions");
const playerEvents = require("../player/events");

const fail = (code, extra = {}) => ({ ok: false, code, ...extra });

// 조작 뒤 패널을 지금 상태로. 패널을 못 고쳐도 조작은 된 것이다
const refresh = (player) => playerEvents.refresh(player).catch((error) => log.warn(`조작 뒤 패널 갱신 실패: ${error?.message || error}`));

// 플레이어가 있나, 권한이 있나. 막히면 실패 결과, 지나가면 null
async function gate(player, actor, check = perm.checkControl) {
  if (!player) return fail("no-player");
  if (actor?.owner) return null;
  const message = await check(actor?.member, player);
  return message ? fail("no-permission", { message }) : null;
}

const needTrack = (player) => (player.currentTrack ? null : fail("no-track"));

/** 멈춤 · 재개를 뒤집는다 */
async function pause(player, actor) {
  const blocked = (await gate(player, actor)) ?? needTrack(player);
  if (blocked) return blocked;
  const resuming = player.paused;
  if (!(resuming ? player.resume() : player.pause())) return fail("failed");
  await refresh(player);
  return { ok: true, paused: !resuming, track: player.currentTrack };
}

/**
 * 지금 곡을 건너뛴다. 한곡 반복 중이면 처음부터 다시(restarted).
 * allowEmpty: 다음 곡이 없어도 건너뛴다(대기열 소진으로 간다)
 */
async function skip(player, actor, { allowEmpty = false } = {}) {
  const blocked = (await gate(player, actor, perm.checkSkip)) ?? needTrack(player);
  if (blocked) return blocked;
  const restarted = player.loop === "track";
  if (!allowEmpty && player.queue.length === 0 && !restarted) return fail("nothing-to-skip");
  const track = player.currentTrack;
  if (!player.skip()) return fail("failed");
  if (!restarted && player.currentTrack) await refresh(player);
  return { ok: true, track, restarted };
}

/** 멈추고 대기열을 비우고 나간다. 세션도 지운다 */
async function stop(player, actor, players) {
  const blocked = await gate(player, actor);
  if (blocked) return blocked;
  const track = player.currentTrack;
  const cleared = player.queue.length;
  player.stop();
  players.delete(player.guild.id);
  await playerEvents.ended(player, "stop").catch((error) => log.warn(`정지 뒤 패널 갱신 실패: ${error?.message || error}`));
  return { ok: true, track, cleared };
}

/**
 * 이전 곡으로. 한곡 반복 중이면 지금 곡을 처음부터(restarted).
 * requireTrack: 틀고 있는 곡이 없으면 거절한다
 */
async function previous(player, actor, { requireTrack = false } = {}) {
  const blocked = (await gate(player, actor)) ?? (requireTrack ? needTrack(player) : null);
  if (blocked) return blocked;
  const restarted = player.loop === "track";
  if (player.previousTracks.length === 0 && !restarted) return fail("no-previous");
  if (!player.previous()) return fail("failed");
  return { ok: true, restarted };
}

/**
 * 곡 안의 위치로. reason 은 로그에 남는 원인(seek · replay · highlight · dashboard).
 * refuseStarting: 곡을 여는 중이면 거절한다. onAccepted: 전제 조건을 지난 뒤, 오래 걸리는 일 전에 부른다(응답 미루기 등)
 */
async function seek(player, actor, ms, { reason = "seek", refuseStarting = false, onAccepted } = {}) {
  const blocked = (await gate(player, actor)) ?? needTrack(player) ?? seekBlocked(player, refuseStarting);
  if (blocked) return blocked;
  await onAccepted?.();
  await player.seek(ms, reason);
  await refresh(player);
  return { ok: true, ms, track: player.currentTrack };
}

function seekBlocked(player, refuseStarting) {
  // 라이브에는 실시간밖에 없다. 옮길 자리가 없다
  if (player.isLive) return fail("live-no-seek");
  if (refuseStarting && player.isPlayStarting) return fail("starting");
  return null;
}

/** 처음부터 다시 */
const replay = (player, actor, opts = {}) => seek(player, actor, 0, { ...opts, reason: "replay" });

/** SponsorBlock 하이라이트 지점으로 */
async function highlight(player, actor, opts = {}) {
  const blocked = (await gate(player, actor)) ?? needTrack(player) ?? seekBlocked(player, opts.refuseStarting);
  if (blocked) return blocked;
  const at = player.sponsor?.highlightAt;
  if (at === null || at === undefined) return fail("no-highlight");
  return seek(player, actor, Math.max(0, Math.floor(at * 1000)), { ...opts, reason: "highlight" });
}

/** 음량(0 ~ 100 정수) */
async function volume(player, actor, level) {
  const blocked = await gate(player, actor);
  if (blocked) return blocked;
  if (!Number.isInteger(level) || level < 0 || level > 100) return fail("bad-volume");
  const before = player.volume;
  const applied = player.setVolume(level) ?? level;
  await refresh(player);
  return { ok: true, before, level: applied };
}

/** 반복 모드. mode: false(끔) · "track" · "queue" */
async function loop(player, actor, mode) {
  const blocked = (await gate(player, actor)) ?? needTrack(player);
  if (blocked) return blocked;
  if (![false, "track", "queue"].includes(mode)) return fail("bad-loop-mode");
  // 끝이 없는 것은 반복할 수 없다. 끄는 것은 언제나 통한다
  if (mode && player.hasLiveTrack()) return fail("live-no-loop");
  player.setLoop(mode);
  await refresh(player);
  return { ok: true, mode, track: player.currentTrack };
}

/** 반복 버튼의 다음 모드: 끔 → 한곡 → 대기열 → 끔 */
function nextLoopMode(current) {
  if (current === false || current === "off") return "track";
  return current === "track" ? "queue" : false;
}

/** 대기열 섞기 */
async function shuffle(player, actor) {
  const blocked = await gate(player, actor);
  if (blocked) return blocked;
  if (player.queue.length < 2) return fail("too-few-to-shuffle");
  player.shuffleQueue();
  await refresh(player);
  return { ok: true, count: player.queue.length };
}

/** 대기열에서 한 곡 빼기. index 는 0부터. 자기가 넣은 곡은 DJ 가 아니어도 뺄 수 있어 권한은 곡을 보고 판정한다 */
async function remove(player, actor, index) {
  if (!player) return fail("no-player");
  if (player.queue.length === 0) return fail("queue-empty");
  if (!Number.isInteger(index) || index < 0 || index >= player.queue.length) return fail("bad-position", { size: player.queue.length });
  const blocked = await gate(player, actor, (member) => perm.checkRemoveTrack(member, player.queue[index]));
  if (blocked) return blocked;
  const track = player.removeFromQueue(index);
  await refresh(player);
  return { ok: true, track, left: player.queue.length };
}

/**
 * 대기열 안에서 옮기기. from · to 는 0부터.
 * allowSame: 같은 자리로 옮기기를 거절하지 않는다(아무 일도 안 일어난다)
 */
async function move(player, actor, from, to, { allowSame = false } = {}) {
  const blocked = await gate(player, actor);
  if (blocked) return blocked;
  const size = player.queue.length;
  if (size < 2) return fail("too-few-to-move");
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < size;
  if (!inRange(from) || !inRange(to)) return fail("bad-position", { size });
  if (from === to && !allowSame) return fail("same-position");
  const track = player.queue[from];
  player.moveInQueue(from, to);
  await refresh(player);
  return { ok: true, track, from, to };
}

/** 대기열 비우기(지금 곡은 그대로) */
async function clear(player, actor) {
  const blocked = await gate(player, actor);
  if (blocked) return blocked;
  const count = player.queue.length;
  if (count === 0) return fail("queue-empty");
  player.clearQueue();
  await refresh(player);
  return { ok: true, count, track: player.currentTrack };
}

/** 대기열의 한 곡으로 바로 넘어간다. 한곡 반복 중에도 그 곡으로 간다 */
async function jump(player, actor, index) {
  const blocked = await gate(player, actor);
  if (blocked) return blocked;
  if (!Number.isInteger(index) || index < 0 || index >= player.queue.length) return fail("bad-position", { size: player.queue.length });
  const track = player.queue[index];
  player.moveInQueue(index, 0);
  if (!player.skip("jump")) {
    player.moveInQueue(0, index);
    return fail("failed");
  }
  return { ok: true, track };
}

/**
 * 나가기. 세션을 남겨 /join 이 복구한다. 플레이어가 없어도 봇이 음성에 남아 있으면 나간다(left: "voice-only").
 * 권한은 플레이어가 없어도 본다
 */
async function leave(guild, actor, players) {
  if (!actor?.owner) {
    const message = await perm.checkControl(actor?.member);
    if (message) return fail("no-permission", { message });
  }
  const player = players.get(guild.id);
  if (!player) {
    if (!guild.members.me?.voice?.channel) return fail("no-player");
    await guild.members.me.voice.disconnect();
    return { ok: true, left: "voice-only" };
  }
  const track = player.currentTrack;
  const saved = { queue: player.queue.length, positionSec: Math.floor((player.getCurrentTime?.() || 0) / 1000) };
  await player.leaveAndSave();
  players.delete(guild.id);
  await playerEvents.ended(player, track ? "leave" : "disconnected").catch((error) => log.warn(`나간 뒤 패널 갱신 실패: ${error?.message || error}`));
  return { ok: true, left: "player", track, saved };
}

module.exports = { pause, skip, stop, previous, seek, replay, highlight, volume, loop, nextLoopMode, shuffle, remove, move, clear, jump, leave };
