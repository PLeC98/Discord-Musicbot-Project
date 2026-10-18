// 현재곡·대기열·기록을 바꾸는 유일한 통로. 필드는 플레이어에 그대로 두고 읽기는 어디서든 한다.
// 바꾼 뒤 player.trackSink에 알린다. 세션 저장이 메모리를 따라가는 길은 이것 하나다.

import { HISTORY_MAX } from "../rules/history.ts";
import type { Loop } from "../rules/loop-cycle.ts";
import type { QueuedTrack } from "./track.ts";

/** 바뀐 것을 듣는 쪽(세션 저장) */
type TrackSink = {
  onSetCurrent(track: QueuedTrack | null): void;
  onEnqueue(tracks: QueuedTrack[], front: boolean): void;
  onTake(index: number): void;
  onRetire(track: QueuedTrack, requeue: boolean): void;
  onRewind(track: QueuedTrack, copy: number, current: QueuedTrack | null, fromHistory: boolean): void;
  onRemoveAt(index: number): void;
  onMove(from: number, to: number): void;
  onClearQueue(): void;
  onReset(history: boolean): void;
  onReplace(): void;
};
/** 곡 상태를 가진 쪽. 플레이어가 그대로 맞는다. 함수마다 쓰는 필드만 받는다 */
type Tracks = { currentTrack: QueuedTrack | null; queue: QueuedTrack[]; previousTracks: QueuedTrack[]; loop: Loop; trackSink?: TrackSink | null };
type Queue = Pick<Tracks, "queue" | "trackSink">;

const sinkOf = (player: Pick<Tracks, "trackSink">) => player.trackSink;

// 대기열 줄 번호. 곡 객체가 처음 들어올 때 찍는다. 옮기기 · 섞기 · 되감기 · 반복으로 대기열 끝에 돌리기는 같은 객체라 번호가 그대로다.
// 열거되지 않는 필드라 복사본({...track})에는 따라가지 않는다. 복사해 넣은 곡은 새 번호를 받아 번호가 겹치지 않는다.
// 세션 저장이 번호를 같이 적고 복원할 때 그대로 붙여 오므로(store/player-sessions), 이미 번호가 있는 곡을 보면 세는 값을 그 위로 올린다.
// 그래야 봇을 다시 시작해도 같은 곡이 같은 번호이고, 새로 들어오는 곡이 복원한 번호와 겹치지 않는다
let lastEntry = 0;
function admit(tracks: Iterable<QueuedTrack | null | undefined>) {
  for (const track of tracks) {
    if (!track) continue;
    if (track.entry === undefined) Object.defineProperty(track, "entry", { value: ++lastEntry, enumerable: false });
    else if (track.entry > lastEntry) lastEntry = track.entry;
  }
}

function init(player: Pick<Tracks, "currentTrack" | "queue" | "previousTracks">) {
  player.currentTrack = null;
  player.queue = [];
  player.previousTracks = [];
}

function setCurrent(player: Pick<Tracks, "currentTrack" | "trackSink">, track: QueuedTrack | null | undefined) {
  admit([track]);
  player.currentTrack = track ?? null;
  sinkOf(player)?.onSetCurrent(player.currentTrack);
}

function enqueue(player: Queue, tracks: QueuedTrack[], { front = false }: { front?: boolean } = {}) {
  if (tracks.length === 0) return;
  admit(tracks);
  if (front) player.queue.unshift(...tracks);
  else player.queue.push(...tracks);
  sinkOf(player)?.onEnqueue(tracks, front);
}

// 사용자가 넣은 곡은 자동재생이 미리 선택해 둔 곡보다 앞에 선다.
// 미리 선택이 켜지면 대기열이 비어 있지 않은 것이 기본이라, 그냥 뒤에 붙이면 사용자 곡이 뒤로 밀린다.
function enqueueAheadOfAutoplay(player: Queue, tracks: QueuedTrack[]) {
  if (tracks.length === 0) return;
  const at = player.queue.findIndex((t) => t?.autoplay);
  if (at < 0) return enqueue(player, tracks);
  admit(tracks);
  player.queue.splice(at, 0, ...tracks);
  sinkOf(player)?.onReplace();
}

// 자동재생이 미리 선택해 둔 곡만 제거한다. 사용자가 넣은 곡은 그대로 둔다. 반환: 제거한 수
function dropAutoplay(player: Queue) {
  const before = player.queue.length;
  player.queue = player.queue.filter((t) => !t?.autoplay);
  const removed = before - player.queue.length;
  if (removed > 0) sinkOf(player)?.onReplace();
  return removed;
}

// anchorId 곡 바로 뒤에 넣는다. 맨 앞에 넣은 목록을 이어 넣을 때. 그 곡이 이미 재생돼 없으면 맨 앞.
function insertAfter(player: Queue, anchorId: string | undefined, tracks: QueuedTrack[]) {
  if (tracks.length === 0) return;
  admit(tracks);
  const at = player.queue.findIndex((t) => t.id === anchorId) + 1;
  player.queue.splice(at, 0, ...tracks);
  sinkOf(player)?.onReplace();
}

// 맨 앞 곡을 현재곡으로. 다음 곡은 언제나 맨 앞이다(셔플은 대기열을 한 번 섞을 뿐이다).
function shiftNext(player: Pick<Tracks, "currentTrack" | "queue" | "trackSink">) {
  if (player.queue.length === 0) return null;
  player.currentTrack = player.queue.shift() ?? null;
  sinkOf(player)?.onTake(0);
  return player.currentTrack;
}

// 끝난 곡을 기록에 남기고 큐 반복이면 대기열 끝으로. 현재곡은 비우지 않는다. 다음 곡이 덮는다.
function retire(player: Pick<Tracks, "previousTracks" | "queue" | "trackSink">, track: QueuedTrack, { requeue = false }: { requeue?: boolean } = {}) {
  player.previousTracks.push(track);
  if (player.previousTracks.length > HISTORY_MAX) player.previousTracks.shift();
  if (requeue) player.queue.push(track);
  sinkOf(player)?.onRetire(track, requeue);
}

// 이전 곡(기록 끝)을 맨 앞에, 중단된 현재곡을 그 바로 뒤에. 이전 곡이 끝나면 원래 위치부터 이어진다.
// 대기열 반복이 아닐 때 쓴다(반복이면 rewindRing)
function rewind(player: Tracks) {
  // 대기열 반복의 이전 곡(rewindRing)은 기록을 건드리지 않아, 고리로 되돌린 지금 곡이 기록 끝에도 남는다.
  // 반복을 끈 뒤 이전 곡을 누르면 그 곡(= 지금 곡)이 한 번 더 생기므로 건너뛴다. 같은 객체일 때만(일부러 다시 넣은 같은 곡은 다른 객체다)
  let stale = false;
  while (player.currentTrack && player.previousTracks.at(-1) === player.currentTrack) {
    player.previousTracks.pop();
    stale = true;
  }
  const prev = player.previousTracks.pop();
  if (!prev) {
    if (stale) sinkOf(player)?.onReplace();
    return null;
  }
  // 반복을 끄기 전에 대기열 끝으로 돌아간 사본이 남아 있을 수 있다. 빼지 않으면 곡이 하나 늘어난다
  const copy = player.queue.lastIndexOf(prev);
  if (copy >= 0) player.queue.splice(copy, 1);
  player.queue.unshift(prev);
  const current = player.currentTrack;
  if (current) player.queue.splice(1, 0, current);
  // 기록을 하나 더 뺐으면 저장소는 통째로 다시 쓴다(onRewind 는 기록 한 행만 뺀다)
  if (stale) sinkOf(player)?.onReplace();
  else sinkOf(player)?.onRewind(prev, copy, current, true);
  return prev;
}

// 대기열 반복의 이전 곡. 대기열이 고리라 지금 곡 바로 앞은 대기열 맨 끝 곡이다. 기록은 건드리지 않는다
function rewindRing(player: Tracks) {
  const copy = player.queue.length - 1;
  if (copy < 0) return null;
  const [prev] = player.queue.splice(copy, 1);
  player.queue.unshift(prev);
  const current = player.currentTrack;
  if (current) player.queue.splice(1, 0, current);
  sinkOf(player)?.onRewind(prev, copy, current, false);
  return prev;
}

function removeAt(player: Queue, index: number) {
  if (!(index >= 0 && index < player.queue.length)) return null;
  const [track] = player.queue.splice(index, 1);
  sinkOf(player)?.onRemoveAt(index);
  return track;
}

function move(player: Queue, from: number, to: number) {
  const n = player.queue.length;
  if (!(from >= 0 && from < n && to >= 0 && to < n)) return null;
  const [track] = player.queue.splice(from, 1);
  player.queue.splice(to, 0, track);
  sinkOf(player)?.onMove(from, to);
  return track;
}

// random: [0, 1) 수를 주는 것. 테스트가 정해진 수열을 넘긴다
function shuffle(player: Queue, random: () => number = Math.random) {
  const q = player.queue;
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [q[i], q[j]] = [q[j], q[i]];
  }
  sinkOf(player)?.onReplace();
}

function clearQueue(player: Queue) {
  const cleared = player.queue.length;
  player.queue = [];
  sinkOf(player)?.onClearQueue();
  return cleared;
}

// 대기열과 현재곡을 비운다. 기록은 플레이어를 버릴 때와 대기열이 다 끝났을 때 함께 비운다.
function reset(player: Pick<Tracks, "currentTrack" | "queue" | "previousTracks" | "trackSink">, { history = false }: { history?: boolean } = {}) {
  player.queue = [];
  player.currentTrack = null;
  if (history) player.previousTracks = [];
  sinkOf(player)?.onReset(history);
}

// persisted: 저장소에서 막 읽은 그대로라 다시 쓰지 않는다. 수천 곡이면 되쓰기가 다른 서버의 재생까지 멈춘다
function restore(player: Pick<Tracks, "currentTrack" | "queue" | "previousTracks" | "trackSink">, { current = null, queue = [], history = [] }: { current?: QueuedTrack | null; queue?: QueuedTrack[]; history?: QueuedTrack[] }, { persisted = false }: { persisted?: boolean } = {}) {
  admit([current, ...queue, ...history]);
  player.currentTrack = current ?? null;
  player.queue = queue;
  player.previousTracks = history.slice(-HISTORY_MAX);
  if (!persisted) sinkOf(player)?.onReplace();
}

export { HISTORY_MAX, init, setCurrent, enqueue, enqueueAheadOfAutoplay, dropAutoplay, insertAfter, shiftNext, retire, rewind, rewindRing, removeAt, move, shuffle, clearQueue, reset, restore };
export type { TrackSink, Tracks };
