// 아이콘 버튼: 동그라미, 터치 영역 48px(tap)
const SHAPE = "tap state-layer shrink-0 rounded-full flex items-center justify-center cursor-pointer disabled:cursor-not-allowed";

/** 기본 아이콘 버튼(흐린 글자색, 비활성 38%). 크기는 쓰는 곳이 붙인다(size-6, 8, 10) */
export const ICON_BTN = `${SHAPE} text-on-surface-variant disabled:opacity-38`;

const SIZES = { 32: "size-8", 40: "size-10" } as const;
// 채운 것은 비활성이면 바탕 on-surface 12%, 글자 38%(M3)
const LOOKS = {
  standard: "text-on-surface-variant disabled:opacity-38",
  /** 글자색은 둘레를 따른다(색을 입힌 면 위) */
  plain: "disabled:opacity-38",
  /** 쉴 때 outline 색으로 흐리게 두는 것(빼기). 올리면 밝히는 것은 쓰는 곳이 group-hover 로 */
  quiet: "text-outline transition-colors disabled:opacity-38",
  filled: "bg-primary text-on-primary transition-[background-color,color] effects-fast disabled:bg-on-surface/12 disabled:text-on-surface/38",
  tonal: "bg-secondary-container text-on-secondary-container transition-[background-color,color] effects-fast disabled:bg-on-surface/12 disabled:text-on-surface/38",
} as const;

/** 크기(32, 40px)와 모양(standard, plain, quiet, filled = primary 채움, tonal = 색조)이 정해진 아이콘 버튼 */
export function iconButton(size: keyof typeof SIZES, look: keyof typeof LOOKS = "standard"): string {
  return `${SHAPE} ${SIZES[size]} ${LOOKS[look]}`;
}
