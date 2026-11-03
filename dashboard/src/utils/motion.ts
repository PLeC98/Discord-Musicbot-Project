// 움직임 토큰(style.css 의 spring-*, effects-*)을 JS 쪽에서 쓸 때의 값

/** 대화상자 넘김의 길이(ms). 판의 커짐(spring-fast 390)이 겉의 투명도보다 늦게 끝나 Vue 가 겉만 보고 끝내지 않게 준다 */
export const DIALOG_MS = { enter: 390, leave: 160 };

/** scrollTo, scrollIntoView 의 behavior. 움직임 줄이기면 바로 옮긴다(CSS 전역 규칙이 JS 스크롤은 막지 못한다) */
export function scrollMotion(): ScrollBehavior {
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
