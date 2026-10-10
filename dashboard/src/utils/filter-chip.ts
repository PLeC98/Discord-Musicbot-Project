// 필터 칩: 높이 32 · 모서리 8(M3), 좌우 8 · 글과 수 사이 4(M3 의 16 · 8 을 반으로, 사용자가 정함), 꺼짐은 테두리, 켜짐은 secondary-container(앞쪽 체크는 두지 않는다. 켜고 끌 때 칩 폭이 바뀌지 않게)
export const FILTER_CHIP = "tap state-layer inline-flex items-center gap-1 h-8 rounded-sm text-xs font-medium cursor-pointer transition-[background-color,color,border-color] duration-150";
export const FILTER_CHIP_ON = "px-2 bg-secondary-container text-on-secondary-container border border-transparent";
export const FILTER_CHIP_OFF = "px-2 border border-outline-variant text-on-surface-variant";
