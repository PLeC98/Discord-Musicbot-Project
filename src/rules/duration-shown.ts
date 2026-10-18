// 곡 길이 표시. 곡을 처음 보일 때 정해진 값을 흔들지 않는다.
// 모르던 길이를 알게 됐거나, 다운로드한 음원을 잰 값이 보이는 값과 2초 넘게 다를 때만 바꾼다.
// 비트레이트 · 컨테이너마다 길이가 조금씩 다르게 잡혀 재생할 때마다 표시가 흔들리지 않게.
// 곡 끝 판정은 이 값을 쓰지 않는다(재생의 음원 길이, CurrentPlayback.lengthMs).

import type { DurationSource } from "../player/track.ts";

const MEASURED_SWAP_SEC = 2;

type Shown = { duration?: number; durationSource?: DurationSource };

/**
 * 새로 안 길이로 표시를 바꿀지. 바꾸면 새 값, 그대로면 null
 * @param source  provided: 출처가 준 값 · measured: 다운로드한 음원을 잰 값
 */
function shownDuration(track: Shown, sec: number | null | undefined, source: "provided" | "measured"): Required<Shown> | null {
  if (!sec || !(sec > 0)) return null;
  if (!track.duration || !(track.duration > 0)) return { duration: sec, durationSource: source };
  if (source === "measured" && Math.abs(sec - track.duration) > MEASURED_SWAP_SEC) return { duration: sec, durationSource: source };
  return null;
}

export { shownDuration, MEASURED_SWAP_SEC };
