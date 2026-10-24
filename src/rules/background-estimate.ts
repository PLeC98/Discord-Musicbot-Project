// 로그인 배경 편집의 예상 저장 공간(만드는 단계 전부의 크기 하나). 편집 창(보이기 · 최대 용량 알림)과 편집 적용(남은 공간 검사)이 같이 쓴다. Node 를 부르지 않는다.
// 영상은 원본을 받을 때 센 초마다의 크기에서 고른 구간만큼 더하고, 그림은 정지 그림 세트의 어림 그대로다.

import type { LoginBackgroundCrop, LoginBackgroundEstimate } from "../dashboard/contract/login-background.ts";

/** 크롭을 견주는 키(어림을 센 크롭과 같은지 본다) */
const cropKeyOf = (crop: LoginBackgroundCrop) => [crop.x, crop.y, crop.w, crop.h].map((v) => v.toFixed(3)).join(",");

/** 구간이 어림을 잰 구간 안인가(처음 어림은 전체를 잰다) */
const inCounted = (counted: [number, number] | null, range: [number, number]) => !counted || (range[0] >= counted[0] - 0.5 && range[1] <= counted[1] + 0.5);

/** 셈에 쓰는 어림 몫(봇의 기록에는 세는 중 표시가 따로 없다) */
type Counted = Pick<LoginBackgroundEstimate, "perSecond" | "stillBytes" | "crop" | "counted"> & { counting?: boolean };

/**
 * 예상 바이트. 어림이 없거나 · 세는 중이거나 · 다른 크롭의 어림이거나 · 잰 범위 밖의 구간이면 null
 * @param cropKey  지금 크롭의 키(`cropKeyOf`)
 * @param range    영상의 구간(초), 그림은 null
 */
function estimatedBytes(estimate: Counted | null, cropKey: string, range: [number, number] | null): number | null {
  if (!estimate || estimate.counting || cropKeyOf(estimate.crop) !== cropKey) return null;
  if (!range) return estimate.stillBytes;
  if (!inCounted(estimate.counted, range)) return null;
  const [from, to] = range;
  let sum = 0;
  for (let s = Math.floor(from); s < Math.ceil(to); s++) sum += (estimate.perSecond[s] ?? 0) * (Math.min(to, s + 1) - Math.max(from, s));
  return Math.round(sum);
}

export { cropKeyOf, inCounted, estimatedBytes };
