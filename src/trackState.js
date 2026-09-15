"use strict";

// 현재곡·대기열·기록을 바꾸는 유일한 통로. 필드는 플레이어에 그대로 두고 읽기는 어디서든 한다.
// 바꾼 뒤 player.trackSink에 알린다 — 세션 저장이 메모리를 따라가는 길은 이것 하나다.

const HISTORY_MAX = 50;

const sinkOf = (player) => player.trackSink;

function init(player) {
  player.currentTrack = null;
  player.queue = [];
  player.previousTracks = [];
}

function setCurrent(player, track) {
  player.currentTrack = track ?? null;
  sinkOf(player)?.onSetCurrent(player.currentTrack);
}

function enqueue(player, tracks, { front = false } = {}) {
  if (tracks.length === 0) return;
  if (front) player.queue.unshift(...tracks);
  else player.queue.push(...tracks);
  sinkOf(player)?.onEnqueue(tracks, front);
}

// 맨 앞 곡을 현재곡으로 — 다음 곡은 언제나 맨 앞이다(셔플은 대기열을 한 번 섞을 뿐이다).
function shiftNext(player) {
  if (player.queue.length === 0) return null;
  player.currentTrack = player.queue.shift();
  sinkOf(player)?.onTake(0);
  return player.currentTrack;
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
  // 큐 반복이면 끝난 곡은 대기열 끝에도 다시 들어가 있다 — 그 사본을 빼지 않으면 곡이 하나 늘어난다
  const copy = requeuedCopyOf(player, prev);
  if (copy >= 0) player.queue.splice(copy, 1);
  player.queue.unshift(prev);
  const current = player.currentTrack;
  if (current) player.queue.splice(1, 0, current);
  sinkOf(player)?.onRewind(prev, copy, current);
  return prev;
}

function requeuedCopyOf(player, track) {
  const same = player.queue.lastIndexOf(track);
  if (same >= 0) return same;
  // 복원한 뒤에는 기록과 대기열이 서로 다른 객체다. 반복이 아니면 같은 곡은 사용자가 일부러 넣은 것이다.
  if (player.loop !== "queue" || !track.url) return -1;
  for (let i = player.queue.length - 1; i >= 0; i--) {
    if (player.queue[i].url === track.url) return i;
  }
  return -1;
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
  if (history) player.previousTracks = [];
  sinkOf(player)?.onReset(history);
}

// persisted: 저장소에서 막 읽은 그대로라 다시 쓰지 않는다 — 수천 곡이면 되쓰기가 다른 서버의 재생까지 멈춘다
function restore(player, { current = null, queue = [], history = [] }, { persisted = false } = {}) {
  player.currentTrack = current ?? null;
  player.queue = queue;
  player.previousTracks = history.slice(-HISTORY_MAX);
  if (!persisted) sinkOf(player)?.onReplace();
}

module.exports = {
  HISTORY_MAX,
  init,
  setCurrent,
  enqueue,
  shiftNext,
  retire,
  rewind,
  removeAt,
  move,
  shuffle,
  clearQueue,
  reset,
  restore,
};
