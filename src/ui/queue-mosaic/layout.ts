// /queue 썸네일 모자이크의 배치와 넘기는 값. 그리는 쪽(draw, 워커)과 칸 이미지를 만드는 쪽(thumbnails, 메인 스레드)이 같이 쓴다. 캔버스를 부르지 않는다

/** 칸 하나: 대기열 번호, 칸 이미지(thumbnails 가 만든 JPEG. 없으면 null) */
type MosaicCell = { number: number; jpeg: Uint8Array | null };
/** 그릴 값. seed 는 색 체계의 바탕색(#rrggbb, 임베드 색), null 이면 기본색 */
type MosaicData = { seed: string | null; cells: MosaicCell[] };

const WIDTH = 1600;
/** 한 줄의 칸 수, 칸 사이, 칸 모서리 */
const PER_ROW = 5;
const GAP = 16;
const RADIUS = 20;
const CELL_WIDTH = (WIDTH - GAP * (PER_ROW - 1)) / PER_ROW;
/** 칸 크기(16:9) */
const CELL = { width: CELL_WIDTH, height: Math.round((CELL_WIDTH * 9) / 16) } as const;

/** 칸 수에 맞춘 이미지 크기. 한 줄이면 높이도 한 줄 */
function sizeOf(count: number) {
  const rows = Math.max(1, Math.ceil(count / PER_ROW));
  return { width: WIDTH, height: rows * CELL.height + (rows - 1) * GAP };
}

export { WIDTH, PER_ROW, GAP, RADIUS, CELL, sizeOf };
export type { MosaicData, MosaicCell };
