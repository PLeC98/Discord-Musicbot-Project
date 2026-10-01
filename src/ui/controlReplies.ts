// 재생 조작의 응답 화면(응답 틀 ui/frame). 명령과 패널 버튼이 같은 조작을 하면 이 화면 하나를 쓴다

import { frame } from "./frame.ts";
import { formatMs } from "./format.ts";
import * as controlText from "./text/controls.ts";
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

export { paused, skipped, previous, stopped, shuffled, loopSet, highlighting, highlighted };
