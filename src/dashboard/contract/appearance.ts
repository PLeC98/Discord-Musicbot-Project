// 서버와 화면이 주고받는 모양: 파비콘. 운영자 패널에서 크기 칸마다 올리고 갈아 끼우고 지운다. 그림은 봇이 사람이 건드리지 않는 저장 자리에 둔다(dashboard/appearance)
// contract/ 는 서버 경로가 이 모양으로 답하고 화면이 타입으로 받는 곳이다. 브라우저도 부르므로 Node 를 부르지 않는다
// 칸 크기와 다른 정사각형 그림은 봇이 그 크기로 다시 만든다. 정사각형이 아니면 화면이 이미지 편집 대화상자로 잘라 올린다(봇은 래스터는 정사각형만 받는다)

/** 파비콘을 내는 크기(탭 16 · 32 · 48, iOS 홈 화면 180, 매니페스트 192 · 256 · 512). GET /favicon/:size */
const FAVICON_SIZES = [16, 32, 48, 180, 192, 256, 512] as const;
/** 올리는 그림 하나의 상한(바이트). 링크로 받는 그림도 같다 */
const APPEARANCE_MAX_BYTES = 10 * 1024 * 1024;
/** 파비콘으로 받는 가장 작은 변(px) */
const FAVICON_MIN_SIDE = 16;
/** 칸마다 남기는 기록 수(지금 쓰는 그림 포함) */
const FAVICON_HISTORY = 6;
/** 그림마다 함께 두는 보관본의 변 상한. 빈 칸이 다른 칸을 빌릴 때 칸 크기의 그림 대신 이것을 줄여 쓴다(작은 칸 그림을 늘리지 않게). 화면도 잘라 올릴 때 이만큼까지만 넘긴다 */
const FAVICON_RESERVE_SIDE = 512;

/** 칸에 올린 그림 하나. width · height 는 올린 원본(봇이 칸 크기로 다시 만들었다), vector 는 svg, at 은 올린 때(ms) */
type FaviconImage = { id: string; bytes: number; width: number; height: number; vector: boolean; at: number };
/**
 * 칸 하나. current 는 지금 쓰는 그림(history 의 id, 없으면 빈 칸), history 는 새것부터 FAVICON_HISTORY 개까지.
 * from 은 이 크기에 실제로 내는 것: upload 이 칸의 그림 · scaled 다른 칸(source)의 보관본을 줄이거나 늘림 · avatar 봇 프로필 · none 없음.
 * sourceSide 는 scaled 일 때 빌린 보관본의 변(칸보다 작으면 늘려서 흐릴 수 있다)
 */
type FaviconSlot = {
  size: number;
  current: string | null;
  history: FaviconImage[];
  from: "upload" | "scaled" | "avatar" | "none";
  source: number | null;
  sourceSide: number | null;
};
/**
 * GET /api/admin/appearance/favicon 과 바꾸는 요청들의 답. version 은 바뀔 때마다 오른다(화면이 주소에 붙여 옛 그림을 쓰지 않게).
 * PUT /favicon/:size(새 그림, 본문은 그림 그대로) · PUT /favicon/:size/current { id }(기록의 그림으로 갈아 끼우기) · DELETE /favicon/:size(비우기, 기록은 남김) ·
 * DELETE /favicon/:size/history/:id(기록에서 지우기). GET /favicon/:size/history/:id 는 그 그림을 칸 크기로(미리 보기).
 * POST /favicon/fetch { url } 은 링크의 그림을 봇이 대신 받아 그대로 넘긴다(화면이 받아 크기에 추가한다)
 */
type FaviconSlots = { slots: FaviconSlot[]; version: number };

export { APPEARANCE_MAX_BYTES, FAVICON_HISTORY, FAVICON_MIN_SIDE, FAVICON_RESERVE_SIDE, FAVICON_SIZES };
export type { FaviconImage, FaviconSlot, FaviconSlots };
