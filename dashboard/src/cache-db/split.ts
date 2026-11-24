// 캐시 DB 화면의 격자와 편집 창 사이 경계. 넓은 화면(나란히)은 편집 창 폭, 좁은 화면(위아래로 쌓임)은 격자 높이를 끌어 바꾼다(px)

/** 편집 창 폭. min: 제목과 편집 버튼이 줄을 바꿔 들어가는 폭 */
const PANE_WIDTH = { initial: 320, min: 240 };
/** 넓은 화면에서 격자에 남길 최소 폭 */
const GRID_MIN_WIDTH = 320;
/** 좁은 화면의 격자 높이 */
const GRID_HEIGHT = { initial: 512, min: 160 };
/** 경계 손잡이의 두께(격자와 편집 창 사이 간격) */
const HANDLE = 8;
/** 키보드로 한 번에 옮기는 양 */
const KEY_STEP = 16;

const within = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

/**
 * 편집 창 폭. 줄 폭(rowWidth)에서 격자 최소 폭과 손잡이를 남긴다. 줄이 좁아 둘 다 지킬 수 없으면 편집 창 최소 폭이 먼저다.
 * 줄 폭을 아직 재지 못했으면(0) 최소 폭만 지킨다(처음 그릴 때 최소 폭으로 줄었다 돌아오지 않게)
 */
function paneWidth(want: number, rowWidth: number): number {
  return within(want, PANE_WIDTH.min, rowWidth > 0 ? rowWidth - GRID_MIN_WIDTH - HANDLE : Infinity);
}

/** 격자 높이. 창 높이(viewHeight)의 80%까지 */
function gridHeight(want: number, viewHeight: number): number {
  return within(want, GRID_HEIGHT.min, Math.floor(viewHeight * 0.8));
}

export { PANE_WIDTH, GRID_HEIGHT, GRID_MIN_WIDTH, HANDLE, KEY_STEP, paneWidth, gridHeight };
