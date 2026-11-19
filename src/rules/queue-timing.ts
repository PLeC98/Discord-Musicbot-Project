// 대기열의 시간: 곡마다 몇 초 뒤에 시작하나, 아는 길이의 합, 대기열이 다 끝나는 시각. /queue 화면이 쓴다. Node를 부르지 않는다.
// 시작까지의 시간은 지금 곡의 남은 시간에 앞 곡들의 길이를 더한 것이라, 그 사이에 길이를 모르는 곡(라이브, 길이 0)이 있으면 그 뒤로는 모른다.
// 지금 곡의 남은 시간을 모르거나(곡이 없음, 라이브, 길이 모름), 멈춰 있거나, 한 곡 반복이면(지금 곡이 끝나지 않는다) 모두 모른다.
// 끝나는 시각은 모든 곡의 시작을 알고, 대기열 반복도 자동재생도 아닐 때만(반복이면 끝나지 않고, 자동재생이면 곡이 이어진다)

import type { Loop } from "./loop-cycle.ts";

/** 길이를 보는 곡. duration 은 초, 0 이면 모름 */
type Timed = { duration: number; isLive?: boolean };
/** 지금 재생: 곡의 길이와 라이브 여부, 지금 위치(초), 멈춤, 반복, 자동재생 */
type Now = { track: Timed | null; positionSec: number; paused: boolean; loop: Loop; autoplay?: boolean };
type QueueTiming = {
  /** 곡마다 시작까지의 초(대기열 순서). 모르면 null */
  startsIn: Array<number | null>;
  /** 길이를 아는 곡들의 길이 합(초). 지금 곡은 넣지 않는다 */
  totalSec: number;
  /** 마지막 곡이 끝나는 시각(밀리초, nowMs 기준). 모르면 null */
  endsAtMs: number | null;
};

const lengthOf = (track: Timed) => (!track.isLive && Number.isFinite(track.duration) && track.duration > 0 ? track.duration : null);

function queueTiming(now: Now, queue: readonly Timed[], nowMs: number): QueueTiming {
  const totalSec = queue.reduce((sum, track) => sum + (lengthOf(track) ?? 0), 0);
  const currentLength = now.track ? lengthOf(now.track) : null;
  const known = currentLength !== null && !now.paused && now.loop !== "track";
  let at: number | null = known ? Math.max(0, currentLength - now.positionSec) : null;
  const startsIn = queue.map((track) => {
    const start = at;
    const length = lengthOf(track);
    at = at === null || length === null ? null : at + length;
    return start;
  });
  const endsAtMs = at !== null && now.loop !== "queue" && !now.autoplay ? nowMs + at * 1000 : null;
  return { startsIn, totalSec, endsAtMs };
}

export { queueTiming };
export type { QueueTiming, Timed };
