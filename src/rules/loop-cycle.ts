// 반복 버튼의 순환. 디스코드 반복 버튼 · 값 없는 /loop · 대시보드 반복 버튼이 같이 쓴다

import type { Loop } from "../player/track-state.ts";

/** 반복 버튼의 다음 모드: 끔 → 한곡 → 대기열 → 끔 */
function nextLoopMode(current: Loop | "off"): Loop {
  if (current === false || current === "off") return "track";
  return current === "track" ? "queue" : false;
}

export { nextLoopMode };
