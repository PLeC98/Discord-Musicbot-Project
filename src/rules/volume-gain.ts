// 볼륨(0 ~ VOLUME_MAX 정수)을 PCM 에 곱할 볼륨 배율(gain)로. 볼륨 배율로 바꾸는 곳은 여기 하나다.
// 귀는 소리 크기를 로그로 느끼므로 dB 로 고르게 나눈다: 한 칸마다 0.4 dB, 1 이 -39.6 dB, 100 이 0 dB. 0 은 음소거다.
// 세제곱 같은 거듭제곱 곡선은 낮은 쪽이 -70 dB 아래로 떨어져 1 ~ 5 가 들리지 않는다.

import { VOLUME_MAX } from "./limits.ts";

const RANGE_DB = 40;

function gainOf(level: number): number {
  const clamped = Math.max(0, Math.min(VOLUME_MAX, level));
  if (clamped === 0) return 0;
  return 10 ** ((-RANGE_DB * (VOLUME_MAX - clamped)) / VOLUME_MAX / 20);
}

export { gainOf };
