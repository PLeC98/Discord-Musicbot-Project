// 서버와 화면이 주고받는 모양: 로그인 배경. 운영자가 디스플레이 탭에서 그림 · 영상을 올려 다듬고, 봇이 단계(폭별 그림 · 코덱별 HLS)를 구워 로그인 화면이 받는다
// contract/ 는 서버 경로가 이 모양으로 답하고 화면이 타입으로 받는 곳이다. 브라우저도 부르므로 Node 를 부르지 않는다
// 파일은 봇이 사람이 건드리지 않는 저장 자리(database/dashboard/login-background)에 배경마다 따로 둔다. 원본은 단계를 다 구우면 지운다

import type { Code } from "../../rules/problems.ts";

/** 이미지 배경과 영상의 정지 그림을 내는 폭(WebP). 원본보다 큰 폭은 만들지 않는다 */
const LOGIN_BG_WIDTHS = [1280, 1920, 2560, 3840] as const;
/** 영상 코덱. 기기는 이 차례로 하나를 고르고 재생 중에는 바꾸지 않는다 */
const LOGIN_BG_CODECS = ["av1", "vp9", "h264"] as const;
type LoginBackgroundCodec = (typeof LOGIN_BG_CODECS)[number];

/** 반복 이음매를 넘기는 효과(재생에서 건다): 없음 · 마지막 프레임 겹치기 · 페이드(테마 색) · 페이드(검정) · 블러 전환 */
const SEAM_KINDS = ["cut", "freeze", "cover", "black", "blur"] as const;
type SeamKind = (typeof SEAM_KINDS)[number];
/** 넘기는 효과의 길이(초) */
const SEAM_SECONDS = [0.5, 1, 2] as const;
type SeamSeconds = (typeof SEAM_SECONDS)[number];

/** 흐림 상한(화면 폭의 %). 앨범아트 배경 정도 */
const LOGIN_BG_BLUR_MAX = 1.6;
/** 화면에서 거는 값의 처음 값. 흐림은 지금 로그인 화면(봇 프로필 그림 배경)과 같다 */
const LOGIN_BG_OPTIONS_DEFAULT: LoginBackgroundOptions = { blur: 0.5, cover: 35, follow: true, seam: { kind: "cut", seconds: 1 } };
/** 기록 · 저장 한도의 처음 값. maxBytes 0 이면 무제한 */
const LOGIN_BG_LIMITS_DEFAULT: LoginBackgroundLimits = { history: 5, maxBytes: 10 * 1024 ** 3 };
/** 굽기 전 어림을 넉넉히 잡는 몫(넘을 것 같으면 알리기만, 구운 뒤 실제 크기로 지킨다) */
const LOGIN_BG_ESTIMATE_MARGIN = 1.3;

/**
 * 만드는 단계. 앞의 셋(받기 · 미리보기와 크기 어림 · 시간 막대 장면 띠)은 편집 전, 나머지는 편집을 적용한 뒤다.
 * 배경마다 해당하는 것만 한다(highRes 는 유튜브만, probe · tones · h264 · encode 는 영상만, stills 는 그림만). encode 는 AV1 · VP9 단계 전부, drop 은 원본 지우기
 */
const LOGIN_BG_STAGES = ["receive", "preview", "probe", "highRes", "thumb", "stills", "tones", "h264", "encode", "drop"] as const;
type LoginBackgroundStage = (typeof LOGIN_BG_STAGES)[number];
/** 편집 전 단계 */
const LOGIN_BG_BEFORE_EDIT: readonly LoginBackgroundStage[] = ["receive", "preview", "probe"];

/** 화면에서 거는 값(CSS). blur 는 화면 폭의 %(기기마다 같은 정도로), cover 는 덮개 진하기 %(0 ~ 100), follow 는 영상 따라 테마 색(장면이 바뀔 때만) */
type LoginBackgroundOptions = { blur: number; cover: number; follow: boolean; seam: { kind: SeamKind; seconds: SeamSeconds } };
/** 꽉 채울 때 남길 곳(가로 · 세로 %, 0 ~ 100). 배경마다 */
type LoginBackgroundPosition = { x: number; y: number };

// ── 로그인 화면(로그인 전, 공개) ──

/** 폭별 그림 하나 */
type LoginBackgroundStill = { width: number; url: string };
/** HLS 단계 하나. codecs 는 RFC 6381 코덱 문자열, bandwidth 는 2초 최대(bps). 기기 판정(decodingInfo)에 그대로 넘긴다 */
type LoginBackgroundRung = { width: number; height: number; codecs: string; bandwidth: number; frameRate: number };
/** 코덱 하나의 HLS 목록(url, 단계는 낮은 것부터). 코덱을 섞은 목록은 두지 않는다 */
type LoginBackgroundStream = { codec: LoginBackgroundCodec; url: string; rungs: LoginBackgroundRung[] };
/** 장면 하나. at 은 반복 구간의 처음부터 초, color 는 그 장면의 색(#RRGGBB) */
type LoginBackgroundScene = { at: number; color: string };
/** 로그인 화면에 쓰는 것. 화면에서 거는 값과 지금 배경의 보일 자리 */
type LoginBackgroundLook = LoginBackgroundOptions & { position: LoginBackgroundPosition };
/**
 * GET /api/login-background(로그인 전, 캐시하지 않음). none 이면 봇 프로필 그림 배경.
 * id 는 배경마다 달라 파일 주소(/login-background/:id/…)에 든다: 폭별 그림 · 조각은 1년 immutable, HLS 목록(.m3u8)은 캐시하지 않는다.
 * 굽는 중이면 생긴 것만 싣는다(썸네일 → H.264 → AV1 · VP9). 보고 있는 화면은 받은 그대로 두고 다음 방문부터 더한 것을 쓴다.
 * stills 는 이미지면 폭별 그림, 영상이면 운영자가 고른 썸네일(첫 화면 · 마지막 폴백). color 는 대표색(#RRGGBB).
 * 원본 · 기록 · 올린 파일 이름 · 받은 링크는 싣지 않는다
 */
type LoginBackground = { kind: "none" } | { kind: "image"; id: string; stills: LoginBackgroundStill[]; color: string; look: LoginBackgroundLook } | { kind: "video"; id: string; stills: LoginBackgroundStill[]; color: string; scenes: LoginBackgroundScene[]; streams: LoginBackgroundStream[]; look: LoginBackgroundLook };

// ── 운영자 패널 ──

/** 원본에서 쓸 사각형(0 ~ 1) */
type LoginBackgroundCrop = { x: number; y: number; w: number; h: number };
/** 편집 창에서 정한 것. range 는 쓸 구간(초, 영상만), thumbAt 은 썸네일로 쓸 장면(초, 영상만) */
type LoginBackgroundEdit = { crop: LoginBackgroundCrop; range: [number, number] | null; thumbAt: number | null };
/**
 * 세트 크기 어림(편집 창의 예상 파일 크기 · 예상 인코딩 시간). 원본을 받을 때 원본 전체를 한 번 빠르게 구워 초마다의 세트 크기(perSecond)를 둔다.
 * 구간을 바꾸면 그 초를 더하기만 한다. crop 은 perSecond 를 잰 크롭이고, 크롭을 정하면 고른 구간만 다시 센다(counting).
 * stillBytes 는 정지 그림 세트, encodeRatio 는 영상 1초를 굽는 데 드는 초(이 기기에서 잰 값)
 */
type LoginBackgroundEstimate = { perSecond: number[]; stillBytes: number; crop: LoginBackgroundCrop | null; counting: boolean; encodeRatio: number };
/**
 * 배경이 있는 곳: preparing 편집 전 단계 · editing 편집을 기다림 · queued 다른 배경을 굽는 동안 차례를 기다림(한 번에 하나) ·
 * encoding 적용 뒤 단계 · ready 다 구움 · failed 실패(problem 에 까닭, 다시 올리게 한다)
 */
type LoginBackgroundPhase = "preparing" | "editing" | "queued" | "encoding" | "ready" | "failed";
/** 로그인 화면에 걸 수 있는 것: avatar 아직 없음(봇 프로필 그림 배경) · thumb 썸네일 · partial 저화질 영상까지 · full 다 */
type LoginBackgroundShows = "avatar" | "thumb" | "partial" | "full";
/**
 * 배경 하나. from 은 올린 곳(유튜브는 다운로드 대행), name 은 올린 파일 이름 · 링크, at 은 올린 때 · usedAt 은 마지막으로 로그인 화면에 쓴 때(ms, 한도를 넘으면 오래된 것부터 지운다).
 * bytes 는 지금 가진 파일 전부, width · height · duration · fps 는 원본(그림은 duration · fps 0).
 * stages 는 이 배경에 해당하는 단계, stage 는 지금 하는 단계(없으면 null) · progress 는 그 단계의 0 ~ 1, done 은 끝난 단계.
 * resumed 는 봇이 다시 켜져 끝난 단계는 두고 이어서 굽는 중. estimate 는 미리보기 단계가 끝나면 생긴다(그림은 perSecond 가 빈다)
 */
type LoginBackgroundItem = {
  id: string;
  kind: "image" | "video";
  from: "upload" | "youtube" | "link";
  name: string;
  at: number;
  usedAt: number;
  bytes: number;
  width: number;
  height: number;
  duration: number;
  fps: number;
  edit: LoginBackgroundEdit | null;
  position: LoginBackgroundPosition;
  phase: LoginBackgroundPhase;
  stages: LoginBackgroundStage[];
  stage: LoginBackgroundStage | null;
  progress: number;
  done: LoginBackgroundStage[];
  resumed: boolean;
  shows: LoginBackgroundShows;
  problem: Code | null;
  estimate: LoginBackgroundEstimate | null;
};
/** 기록 · 저장 한도. history 는 남겨 둘 기록 수, maxBytes 는 쓰는 배경과 기록을 합친 크기(0 이면 무제한) */
type LoginBackgroundLimits = { history: number; maxBytes: number };
/**
 * 코덱 하나를 굽는 인코더(봇이 켜질 때 작은 시험으로 고른다). encoder 는 ffmpeg 의 인코더 이름(없으면 null, 그 코덱은 굽지 않는다), hardware 는 GPU 인코더인가,
 * why 는 더 나은 인코더(하드웨어)를 못 쓰는 까닭 · 코덱을 못 굽는 까닭(ffmpeg 가 낸 그대로, 없으면 null)
 */
type LoginBackgroundEncoder = { codec: LoginBackgroundCodec; encoder: string | null; hardware: boolean; why: string | null };
/**
 * GET /api/admin/login-background 와 바꾸는 요청들의 답. current 는 로그인 화면에 쓰는 배경(list 의 id, 없으면 봇 프로필 그림 배경), previous 는 그 앞의 것(인코딩 취소 때 돌아갈 곳).
 * shows 는 로그인 화면에 지금 걸린 것, list 는 쓰는 배경 · 굽는 배경 · 기록(새것부터). usedBytes 는 list 전부, freeBytes 는 저장 자리 디스크의 남은 크기.
 * 진행은 굽는 동안 이것을 다시 읽어 본다.
 * POST /upload?name=(본문은 파일 그대로) · POST /link { url } 은 새 배경을 만든다(편집 전 단계가 끝나면 editing).
 * GET /:id/preview 는 편집 창의 미리보기(영상 480p · 그림), GET /:id/strip 은 시간 막대 장면 띠. PUT /:id/estimate { crop } 은 그 크롭으로 다시 센다.
 * PUT /:id/edit LoginBackgroundEdit 는 편집을 적용해 굽는다(차례가 오면). PUT /:id/position LoginBackgroundPosition. POST /:id/cancel 은 편집 취소 · 인코딩 취소(이전 배경으로).
 * PUT /current { id } 는 기록의 배경으로 갈아 끼우고, DELETE /current 는 비운다(기록은 남김). DELETE /:id 는 기록에서 지운다.
 * PUT /options LoginBackgroundOptions · PUT /limits LoginBackgroundLimits(줄이면 바로 지킨다).
 * 백업은 백업 탭의 내보내기 종류로 둔다(settings-archive)
 */
type LoginBackgroundState = {
  current: string | null;
  previous: string | null;
  shows: LoginBackgroundShows;
  list: LoginBackgroundItem[];
  options: LoginBackgroundOptions;
  limits: LoginBackgroundLimits;
  usedBytes: number;
  freeBytes: number;
  encoders: LoginBackgroundEncoder[];
};

export { LOGIN_BG_WIDTHS, LOGIN_BG_CODECS, SEAM_KINDS, SEAM_SECONDS, LOGIN_BG_BLUR_MAX, LOGIN_BG_OPTIONS_DEFAULT, LOGIN_BG_LIMITS_DEFAULT, LOGIN_BG_ESTIMATE_MARGIN, LOGIN_BG_STAGES, LOGIN_BG_BEFORE_EDIT };
export type { LoginBackgroundCodec, SeamKind, SeamSeconds, LoginBackgroundOptions, LoginBackgroundPosition, LoginBackgroundStill, LoginBackgroundRung, LoginBackgroundStream, LoginBackgroundScene, LoginBackgroundLook, LoginBackground, LoginBackgroundCrop, LoginBackgroundEdit, LoginBackgroundEstimate, LoginBackgroundPhase, LoginBackgroundShows, LoginBackgroundStage, LoginBackgroundItem, LoginBackgroundLimits, LoginBackgroundEncoder, LoginBackgroundState };
