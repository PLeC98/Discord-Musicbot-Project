"use strict";

// 현재곡·대기열·기록을 바꾸는 유일한 통로. 필드는 플레이어에 그대로 두고 읽기는 어디서든 한다.
// 바꾼 뒤 player.trackSink에 알린다 — 세션 저장이 메모리를 따라가는 길은 이것 하나다.

const HISTORY_MAX = 50;

const sinkOf = (player) => player.trackSink;

function init(player) {
  player.currentTrack = null;
  player.queue = [];
  player.previousTracks = [];
  // 맨 앞에 일부러 둔 곡이 있다(점프·이전곡·앞에 추가) — 셔플이 켜져 있어도 다음은 그 곡
  player.nextFromFront = false;
}

function setCurrent(player, track) {
  player.currentTrack = track ?? null;
  sinkOf(player)?.onSetCurrent(player.currentTrack);
}

function enqueue(player, tracks, { front = false } = {}) {
  if (tracks.length === 0) return;
  if (front) {
    player.queue.unshift(...tracks);
    if (player.currentTrack) player.nextFromFront = true;
  } else {
    player.queue.push(...tracks);
  }
  sinkOf(player)?.onEnqueue(tracks, front);
}

function takeAt(player, index) {
  player.currentTrack = player.queue.splice(index, 1)[0];
  sinkOf(player)?.onTake(index);
  return player.currentTrack;
}

// 맨 앞 곡을 현재곡으로. 셔플·고정과 무관하다.
function shiftNext(player) {
  if (player.queue.length === 0) return null;
  return takeAt(player, 0);
}

// 곡이 끝난 뒤의 다음 곡 — 고정이 있으면 그것, 셔플이면 무작위, 아니면 맨 앞.
function pickNext(player) {
  if (player.queue.length === 0) return null;
  let index = 0;
  if (player.nextFromFront) player.nextFromFront = false;
  else if (player.shuffle) index = Math.floor(Math.random() * player.queue.length);
  return takeAt(player, index);
}

// 끝난 곡을 기록에 남기고 큐 반복이면 대기열 끝으로. 현재곡은 비우지 않는다 — 다음 곡이 덮는다.
function retire(player, track, { requeue = false } = {}) {
  player.previousTracks.push(track);
  if (player.previousTracks.length > HISTORY_MAX) player.previousTracks.shift();
  if (requeue) player.queue.push(track);
  sinkOf(player)?.onRetire(track, requeue);
}

// 이전 곡을 맨 앞에, 중단된 현재곡을 그 바로 뒤에 — 이전 곡이 끝나면 원래 자리부터 이어진다.
function rewind(player) {
  if (player.previousTracks.length === 0) return null;
  const prev = player.previousTracks.pop();
  player.queue.unshift(prev);
  if (player.currentTrack) player.queue.splice(1, 0, player.currentTrack);
  player.nextFromFront = true;
  sinkOf(player)?.onReplace();
  return prev;
}

function promote(player, index) {
  const [track] = player.queue.splice(index, 1);
  player.queue.unshift(track);
  player.nextFromFront = true;
  sinkOf(player)?.onReplace();
  return track;
}

function cancelPromote(player, index) {
  const [track] = player.queue.splice(0, 1);
  player.queue.splice(index, 0, track);
  player.nextFromFront = false;
  sinkOf(player)?.onReplace();
}

function removeAt(player, index) {
  if (!(index >= 0 && index < player.queue.length)) return null;
  const [track] = player.queue.splice(index, 1);
  sinkOf(player)?.onRemoveAt(index);
  return track;
}

function move(player, from, to) {
  const n = player.queue.length;
  if (!(from >= 0 && from < n && to >= 0 && to < n)) return null;
  const [track] = player.queue.splice(from, 1);
  player.queue.splice(to, 0, track);
  sinkOf(player)?.onMove(from, to);
  return track;
}

function shuffle(player) {
  const q = player.queue;
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [q[i], q[j]] = [q[j], q[i]];
  }
  sinkOf(player)?.onReplace();
}

function clearQueue(player) {
  const cleared = player.queue.length;
  player.queue = [];
  sinkOf(player)?.onClearQueue();
  return cleared;
}

// 대기열과 현재곡을 비운다. 기록은 플레이어를 버릴 때만 함께 비운다.
function reset(player, { history = false } = {}) {
  player.queue = [];
  player.currentTrack = null;
  player.nextFromFront = false;
  if (history) player.previousTracks = [];
  sinkOf(player)?.onReset(history);
}

function restore(player, { current = null, queue = [], history = [] }) {
  player.currentTrack = current ?? null;
  player.queue = queue;
  player.previousTracks = history.slice(-HISTORY_MAX);
  player.nextFromFront = false;
  sinkOf(player)?.onReplace();
}

module.exports = {
  HISTORY_MAX,
  init,
  setCurrent,
  enqueue,
  shiftNext,
  pickNext,
  retire,
  rewind,
  promote,
  cancelPromote,
  removeAt,
  move,
  shuffle,
  clearQueue,
  reset,
  restore,
};
