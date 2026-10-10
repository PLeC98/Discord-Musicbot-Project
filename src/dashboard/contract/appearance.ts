// 서버와 화면이 주고받는 모양: 꾸미기(파비콘). 운영자 패널에서 올리고 지운다. 그림은 봇이 사람이 건드리지 않는 저장 자리에 둔다(dashboard/appearance)
// contract/ 는 서버 경로가 이 모양으로 답하고 화면이 타입으로 받는 곳이다. 브라우저도 부르므로 Node 를 부르지 않는다

/** 파비콘을 내는 크기(탭 16 · 32 · 48, iOS 홈 화면 180, 매니페스트 192 · 256 · 512). GET /favicon/:size */
const FAVICON_SIZES = [16, 32, 48, 180, 192, 256, 512] as const;
/** 올리는 그림 하나의 상한(바이트) */
const APPEARANCE_MAX_BYTES = 10 * 1024 * 1024;
/** 파비콘으로 받는 가장 작은 변(px) */
const FAVICON_MIN_SIDE = 16;
/** 파비콘으로 올린 그림을 몇 장까지 두는가(크기마다 하나라 쓰는 크기 수 + svg) */
const FAVICON_MAX_UPLOADS = FAVICON_SIZES.length + 1;

/** 올린 파비콘 그림. side 는 변(px), svg 면 null(어느 크기로나 그린다). 같은 변을 다시 올리면 바꾼다 */
type FaviconUpload = { id: string; side: number | null; bytes: number };
/** 크기마다 무엇을 내는가: 꼭 맞는 그림(exact) · 가장 가까운 그림을 늘이거나 줄임(resized, upload 는 그 그림) · 봇 프로필 그림(avatar) · 없음(none) */
type FaviconUse = { size: number; from: "exact" | "resized" | "avatar" | "none"; upload: string | null };
/** GET /api/admin/appearance. version 은 바뀔 때마다 오른다(화면이 주소에 붙여 옛 그림을 쓰지 않게) */
type Appearance = { favicon: { uploads: FaviconUpload[]; sizes: FaviconUse[]; version: number } };

export { APPEARANCE_MAX_BYTES, FAVICON_MAX_UPLOADS, FAVICON_MIN_SIDE, FAVICON_SIZES };
export type { Appearance, FaviconUpload, FaviconUse };
