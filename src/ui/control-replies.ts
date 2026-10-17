// 재생 조작의 응답 화면(응답 틀 ui/frame). 명령과 패널 버튼이 같은 조작을 하면 이 화면 하나를 쓴다

import { frame, noticeFrame } from "./frame.ts";
import * as errors from "./text/ko/errors.ts";
import { formatDuration, formatMs } from "./format.ts";
import * as controlText from "./text/ko/controls.ts";
import type { Loop } from "../rules/loop-cycle.ts";

type Track = { title: string | null; pageUrl: string; thumbnail?: string | null };
/** 조작한 사람. 멘션으로 보인다 */
type Actor = { toString(): string };

// 누가 했나 줄
const who = (by: Actor) => `${controlText.requestedBy()} ${by}`;

/** 일시정지 · 재개 */
function paused(isPaused: boolean, track: Track, by: Actor) {
  const t = controlText.paused(isPaused, track);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 건너뛰기. 한 곡 반복이면 처음부터 다시 틀었다(restarted) */
function skipped(restarted: boolean, track: Track, by: Actor) {
  const t = restarted ? controlText.restartedOnRepeat() : controlText.skipped(track);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 이전 곡. 한 곡 반복이면 처음부터 다시 틀었다(restarted). track 은 되돌아간 곡 */
function previous(restarted: boolean, track: Track) {
  const t = restarted ? controlText.restartedOnRepeat() : controlText.previous(track);
  return frame({ title: t.title, body: t.body });
}

/** 곡으로 건너뛰기 메뉴에서 골랐다 */
function jumped(track: Track) {
  const t = controlText.jumped(track);
  return frame({ title: t.title, body: t.body });
}

/** 정지. cleared 는 비운 대기열 곡 수 */
function stopped(cleared: number, by: Actor) {
  const t = controlText.stopped(cleared);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 섞기 */
function shuffled(count: number, by: Actor) {
  const t = controlText.shuffled(count);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 반복 모드 */
function loopSet(mode: Loop, by: Actor) {
  const t = controlText.loopSet(mode);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 하이라이트로 건너뛰는 동안 */
const highlighting = () => frame({ body: controlText.highlighting() });
/** 하이라이트로 건너뛰었다. ms 는 옮긴 위치 */
function highlighted(ms: number) {
  const t = controlText.highlighted(formatMs(ms));
  return frame({ title: t.title, body: t.body });
}

/** 처음부터 다시 트는 동안 */
const replaying = () => frame({ body: controlText.replaying() });
/** 처음부터 다시 틀었다 */
function replayed(track: Track, by: Actor) {
  const t = controlText.replayed(track);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true, thumbnail: track.thumbnail });
}

/** 위치를 옮기는 동안 */
const seeking = () => frame({ body: controlText.seeking() });
/** 위치를 옮겼다. ms 는 옮긴 위치 */
function seeked(ms: number) {
  const t = controlText.seeked(formatMs(ms));
  return frame({ title: t.title, body: t.body });
}

/** 대기열 비우기. count 는 버린 곡 수 */
function cleared(count: number, by: Actor) {
  const t = controlText.cleared(count);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 대기열에서 한 곡 빼기. left 는 남은 곡 수 */
function removed(left: number, by: Actor) {
  const t = controlText.removed(left);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 대기열 순서 바꾸기. from · to 는 사람이 센 자리(1부터) */
function moved(track: Track, from: number, to: number, by: Actor) {
  const t = controlText.moved(track, from, to);
  return frame({ title: t.title, body: t.body, footer: [`${t.by} ${by}`], divider: true });
}

/** 음량. before · level 은 0 ~ VOLUME_MAX(rules/limits) */
function volumeSet(before: number, level: number, by: Actor) {
  const t = controlText.volumeSet(before, level);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 음성 채널에서 나갔다. 곡이 있었으면 저장한 곡 · 자리(초) · 대기열 곡 수 */
function left(saved: { track: Track; positionSec: number; queue: number } | null, by: Actor) {
  const t = controlText.left(saved && { track: saved.track, at: formatDuration(saved.positionSec), queue: saved.queue });
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 음성 채널에 들어왔다 · 이미 들어와 있다 */
function joined() {
  const t = controlText.joined();
  return frame({ title: t.title, body: t.body });
}
function alreadyJoined() {
  const t = controlText.alreadyJoined();
  return frame({ title: t.title, body: t.body });
}

/** /join 이 저장한 세션을 복원하는 동안 · 복원했다 */
const restoring = () => frame({ body: controlText.restoring() });
function restored(track: Track, isPaused: boolean) {
  const t = controlText.restored(track, isPaused);
  return frame({ title: t.title, body: t.body });
}
/** 복원한 결과. 이어 튼 곡이 있으면 그 곡, 없으면 까닭(남은 곡이 있으면 연달아 실패해 멈춘 것) */
function restoreResult(track: Track | null, isPaused: boolean, left: number) {
  if (track) return restored(track, isPaused);
  return noticeFrame(left > 0 ? errors.notice("restore-failed-in-row", { left }) : errors.notice("restore-nothing-left"));
}

export { paused, skipped, previous, jumped, stopped, shuffled, loopSet, highlighting, highlighted, replaying, replayed, seeking, seeked, cleared, removed, moved, volumeSet, left, joined, alreadyJoined, restoring, restored, restoreResult };
