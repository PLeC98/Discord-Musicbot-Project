// 재생 조작의 응답 화면(응답 틀 ui/frame). 명령과 패널 버튼이 같은 조작을 하면 이 화면 하나를 쓴다

import { frame } from "./frame.ts";
import { formatDuration, formatMs } from "./format.ts";
import * as controlText from "./text/controls.ts";
import * as labels from "./text/labels.ts";
import type { Loop } from "../player/trackState.ts";

type Track = { title: string; pageUrl: string; thumbnail?: string | null };
/** 조작한 사람. 멘션으로 보인다 */
type Actor = { toString(): string };

// 누가 했나. 칸 이름과 멘션
const who = (label: string, by: Actor) => `${label} ${by}`;

/** 일시정지 · 재개 */
function paused(isPaused: boolean, track: Track, by: Actor) {
  const t = controlText.paused(isPaused, track);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)], thumbnail: track.thumbnail });
}

/** 건너뛰기. 한곡 반복이면 처음부터 다시 틀었다(restarted) */
function skipped(restarted: boolean, track: Track, by: Actor) {
  if (restarted) return frame({ body: controlText.skipRestarted(track) });
  const t = controlText.skipped(track);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)], thumbnail: track.thumbnail });
}

/** 이전 곡 */
const previous = (restarted: boolean) => frame({ body: controlText.previous(restarted) });

/** 정지. cleared 는 비운 대기열 곡 수 */
function stopped(track: Track | null | undefined, cleared: number, by: Actor) {
  const t = controlText.stopped(track, cleared);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by), t.footer] });
}

/** 섞기 */
function shuffled(count: number, by: Actor) {
  const t = controlText.shuffled(count);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)] });
}

/** 반복 모드 */
function loopSet(mode: Loop, track: Track | null | undefined, by: Actor) {
  const t = controlText.loopSet(mode);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)], thumbnail: track?.thumbnail });
}

/** 하이라이트로 옮기는 동안 */
const highlighting = () => frame({ body: controlText.highlighting() });
/** 하이라이트로 옮겼다. ms 는 옮긴 위치 */
function highlighted(track: Track, ms: number) {
  const t = controlText.highlighted(track);
  return frame({ title: t.title, body: t.description, footer: [`${t.at} \`${formatMs(ms)}\``] });
}

/** 처음부터 다시 트는 동안 */
const replaying = () => frame({ body: controlText.replaying() });
/** 처음부터 다시 틀었다 */
function replayed(track: Track, by: Actor) {
  const t = controlText.replayed(track);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)], thumbnail: track.thumbnail });
}

/** 위치를 옮기는 동안 */
const seeking = () => frame({ body: controlText.seeking() });
/** 위치를 옮겼다. ms 는 옮긴 위치 */
function seeked(track: Track, ms: number) {
  const t = controlText.seeked(track);
  return frame({ title: t.title, body: t.description, footer: [`${t.at} \`${formatMs(ms)}\``] });
}

/** 곡으로 건너뛰기 메뉴에서 골랐다 */
const jumped = (track: { title: string }) => frame({ body: controlText.jumped(track) });

/** 대기열 비우기. track 은 남겨 둔 지금 곡 */
function cleared(count: number, track: Track | null | undefined, by: Actor) {
  const t = controlText.cleared(count);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by), track ? `${t.current} **[${track.title}](${track.pageUrl})**` : null] });
}

/** 대기열에서 한 곡 빼기. left 는 남은 곡 수 */
function removed(track: Track, left: number, by: Actor) {
  const t = controlText.removed(track);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by), `${t.left} ${labels.trackCount(left)}`], thumbnail: track.thumbnail });
}

/** 대기열 순서 바꾸기. from · to 는 사람이 센 자리(1부터) */
function moved(track: Track, from: number, to: number, by: Actor) {
  const t = controlText.moved(track, from, to);
  return frame({ title: t.title, body: t.description, footer: [`${t.from} ${t.fromValue}`, `${t.to} ${t.toValue}`, who(t.by, by)] });
}

/** 음량. before · level 은 0~100 */
function volumeSet(before: number, level: number, by: Actor) {
  const t = controlText.volumeSet(before, level);
  return frame({ title: t.title, body: t.description, footer: [who(t.by, by)] });
}

/** 음성 채널에서 나갔다. 곡이 있었으면 저장한 자리(초)와 대기열 곡 수 */
function left(saved: { track: Track; positionSec: number; queue: number } | null, by: Actor) {
  const t = controlText.left();
  const kept = saved ? [`${t.position} \`${formatDuration(saved.positionSec)}\``, `${t.queue} ${labels.trackCount(saved.queue)}`] : [];
  return frame({ title: t.title, body: saved ? `**[${saved.track.title}](${saved.track.pageUrl})**` : null, footer: [who(t.by, by), ...kept, t.footer] });
}
/** 플레이어 없이 봇만 음성에 남아 있었다 */
const leftVoiceOnly = () => frame({ body: controlText.leftVoiceOnly() });

/** 음성 채널에 들어왔다 · 이미 들어와 있다 */
const joined = () => frame({ body: controlText.joined() });
const alreadyJoined = () => frame({ body: controlText.alreadyJoined() });

export { paused, skipped, previous, jumped, stopped, shuffled, loopSet, highlighting, highlighted, replaying, replayed, seeking, seeked, cleared, removed, moved, volumeSet, left, leftVoiceOnly, joined, alreadyJoined };
