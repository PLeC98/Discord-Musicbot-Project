import { ICON_BTN } from "./icon-button.ts";
import { SELECT_ROW } from "./select-row.ts";

// 입력칸: 다른 입력칸과 같은 채운 칸(높이 40 · 모서리 12, 고르면 테두리 primary). 글 · 숫자 · 검색칸이 같이 쓴다
export const FIELD = "h-10 px-4 bg-surface-container-highest border border-transparent rounded-(--r-inner) text-on-surface text-sm font-[inherit] outline-none transition-[border-color] duration-150 focus:border-primary placeholder:text-on-surface-variant";
/** 검색칸(입력칸과 같다) */
export const SEARCH_FIELD = FIELD;
/** 칩이 들어가는 칸(칩 입력 · 태그 고르기): 입력칸과 같은 면, 칩(32)이 줄마다 들어가게 위아래 4 */
export const CHIP_FIELD = "flex flex-wrap items-center gap-1 min-h-10 px-1 py-1 bg-surface-container-highest border border-transparent rounded-(--r-inner) transition-[border-color] duration-150 focus-within:border-primary";
/** 칩 입력 · 태그 고르기의 칩(M3 입력 칩: 높이 32 · 모서리 8 · 테두리, 글자는 한 단계 아래 12, 뒤에 지우기 18) */
export const INPUT_CHIP = "inline-flex items-center gap-1 h-8 max-w-full min-w-0 rounded-sm border border-outline-variant pl-3 pr-1 text-xs text-on-surface";
/** 입력 칩의 지우기(24 안에 18, 누를 자리 48) */
export const INPUT_CHIP_CLOSE = `${ICON_BTN} size-6`;
/** 칸 이름표(이름표 → 칸 4) */
export const FIELD_LABEL = "block mb-1 text-xs text-on-surface-variant";
/** 여러 줄 칸: 입력칸과 같은 면, 위아래 10 · 줄 간격 넉넉히, 세로로만 늘린다 */
export const AREA = "w-full px-4 py-2.5 bg-surface-container-highest border border-transparent rounded-(--r-inner) text-on-surface text-sm leading-relaxed font-[inherit] outline-none resize-y transition-[border-color] duration-150 focus:border-primary placeholder:text-on-surface-variant";
/** 날것 출력(요청 · 응답 · 목록): 고정폭 12, 길면 그 안에서 구른다 */
export const CODE_BOX = "m-0 rounded-(--r-inner) bg-surface-container-highest p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words max-h-72 overflow-auto text-on-surface";
/** 칩 칸 밑에 뜨는 후보 목록(칩 입력 · 태그 고르기), 그 줄, 그 자리의 안내 한 줄(받는 중 · 없음) */
export const CHIP_PANEL = "pane-menu bg-surface-container-low! rounded-lg p-1 overflow-auto";
export const CHIP_PANEL_ROW = `${SELECT_ROW} rounded-xs`;
export const CHIP_PANEL_NOTE = "pane-menu bg-surface-container-low! rounded-lg px-4 py-3 text-xs text-on-surface-variant";
