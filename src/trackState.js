"use strict";

// 현재곡·대기열·기록을 바꾸는 유일한 통로. 필드는 플레이어에 그대로 두고 읽기는 어디서든 한다.
// 바꾼 뒤 player.trackSink에 알린다. 세션 저장이 메모리를 따라가는 길은 이것 하나다.

const HISTORY_MAX = 50;

const sinkOf = (player) => player.trackSink;

function init(player) {
  player.currentTrack = null;
  player.queue = [];
  player.previousTracks = [];
}

// 상한까지 대기열에 더 넣을 수 있는 곡 수. 현재곡은 세지 않는다. max가 0이면 끔.
function roomLeft(player, max) {
  return max > 0 ? Math.max(0, max - player.queue.length) : Infinity;
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

// 사용자가 넣은 곡은 자동재생이 미리 뽑아 둔 곡보다 앞에 선다.
// 미리 뽑기가 켜지면 대기열이 비어 있지 않은 것이 기본이라, 그냥 뒤에 붙이면 사용자 곡이 뒤로 밀린다.
function enqueueAheadOfAutoplay(player, tracks) {
  if (tracks.length === 0) return;
  const at = player.queue.findIndex((t) => t?.autoplay);
  if (at < 0) return enqueue(player, tracks);
  player.queue.splice(at, 0, ...tracks);
  sinkOf(player)?.onReplace();
}

// 자동재생이 미리 뽑아 둔 곡만 걷는다. 사용자가 넣은 곡은 그대로 둔다. 반환: 걷어낸 수
function dropAutoplay(player) {
  const before = player.queue.length;
  player.queue = player.queue.filter((t) => !t?.autoplay);
  const removed = before - player.queue.length;
  if (removed > 0) sinkOf(player)?.onReplace();
  return removed;
}

// anchorId 곡 바로 뒤에 넣는다. 맨 앞에 넣은 목록을 이어 넣을 때. 그 곡이 이미 재생돼 없으면 맨 앞.
function insertAfter(player, anchorId, tracks) {
  if (tracks.length === 0) return;
  const at = player.queue.findIndex((t) => t.id === anchorId) + 1;
  player.queue.splice(at, 0, ...tracks);
  sinkOf(player)?.onReplace();
}

// 맨 앞 곡을 현재곡으로. 다음 곡은 언제나 맨 앞이다(셔플은 대기열을 한 번 섞을 뿐이다).
function shiftNext(player) {
  if (player.queue.length === 0) return null;
  player.currentTrack = player.queue.shift();
  sinkOf(player)?.onTake(0);
  return player.currentTrack;
}

// 끝난 곡을 기록에 남기고 큐 반복이면 대기열 끝으로. 현재곡은 비우지 않는다. 다음 곡이 덮는다.
function retire(player, track, { requeue = false } = {}) {
  player.previousTracks.push(track);
  if (player.previousTracks.length > HISTORY_MAX) player.previousTracks.shift();
  if (requeue) player.queue.push(track);
  sinkOf(player)?.onRetire(track, requeue);
}

// 이전 곡을 맨 앞에, 중단된 현재곡을 그 바로 뒤에. 이전 곡이 끝나면 원래 자리부터 이어진다.
function rewind(player) {
  if (player.previousTracks.length === 0) return null;
  const prev = player.previousTracks.pop();
  // 큐 반복이면 끝난 곡은 대기열 끝에도 다시 들어가 있다. 그 사본을 빼지 않으면 곡이 하나 늘어난다
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

// persisted: 저장소에서 막 읽은 그대로라 다시 쓰지 않는다. 수천 곡이면 되쓰기가 다른 서버의 재생까지 멈춘다
function restore(player, { current = null, queue = [], history = [] }, { persisted = false } = {}) {
  player.currentTrack = current ?? null;
  player.queue = queue;
  player.previousTracks = history.slice(-HISTORY_MAX);
  if (!persisted) sinkOf(player)?.onReplace();
}

module.exports = {
  HISTORY_MAX,
  roomLeft,
  init,
  setCurrent,
  enqueue,
  enqueueAheadOfAutoplay,
  dropAutoplay,
  insertAfter,
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
