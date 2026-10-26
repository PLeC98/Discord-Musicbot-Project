// 볼륨(0 ~ VOLUME_MAX 정수)을 PCM 에 곱할 배율로. 배율로 바꾸는 곳은 여기 하나다.
// 귀는 소리 크기를 로그로 느껴서 선형이면 위쪽 절반이 거의 같게 들린다. 세제곱이면 50 이 -18 dB, 25 가 -36 dB 다.

import { VOLUME_MAX } from "./limits.ts";

function gainOf(level: number): number {
  const ratio = Math.max(0, Math.min(VOLUME_MAX, level)) / VOLUME_MAX;
  return ratio ** 3;
}

export { gainOf };
