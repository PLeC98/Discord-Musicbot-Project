// 재생 조작 버튼의 모양(서버 화면 · 재생 바가 같이 쓴다). 모양은 스포티파이를 따른다: 바탕 없는 글리프, 올리면 밝아지고 누르면 살짝 눌린다. 누를 자리 48(tap)

/** 바탕 */
export const CTL_BTN = "tap shrink-0 flex items-center justify-center cursor-pointer transition-[color,scale] duration-150 active:not-disabled:scale-95 disabled:opacity-38 disabled:cursor-not-allowed";
/** 셔플 · 반복: 흐린 색 40 · 아이콘 24 */
export const TOGGLE_BTN = "relative size-10 text-on-surface-variant hover:not-disabled:text-on-surface";
/** 켜진 셔플 · 반복: 강조색 */
export const TOGGLE_ON = "text-primary! hover:not-disabled:text-primary!";
/** 켜진 반복 아래 점(6, M3 작은 배지) */
export const TOGGLE_DOT = "absolute bottom-0 left-1/2 -translate-x-1/2 size-1.5 rounded-full bg-current";
