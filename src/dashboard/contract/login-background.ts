// 서버와 화면이 주고받는 모양: 로그인 배경. 운영자가 디스플레이 탭에서 그림 · 영상을 올려 다듬고, 봇이 단계(폭별 그림 · 코덱별 HLS)를 구워 로그인 화면이 받는다
// contract/ 는 서버 경로가 이 모양으로 답하고 화면이 타입으로 받는 곳이다. 브라우저도 부르므로 Node 를 부르지 않는다
// 파일은 봇이 사람이 건드리지 않는 저장 자리(database/dashboard/login-background)에 배경마다 따로 둔다. 원본은 단계를 다 구우면 지운다

import type { Code } from "../../rules/problems.ts";

/** 정지 그림(이미지 배경 · 영상의 썸네일)을 내는 폭(WebP). 원본(크롭)보다 큰 폭은 만들지 않고, 원본이 가장 작은 폭보다 작으면 원본 폭 하나 */
const LOGIN_BG_WIDTHS = [1280, 1920, 2560, 3840] as const;
/** 영상 코덱. 기기는 이 차례로 하나를 고르고 재생 중에는 바꾸지 않는다(재생이 실패하면 다음 코덱, 다 실패하면 정지 그림) */
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
/** 덮개 진하기 상한(%). 배경 불투명도 20% 까지 */
const LOGIN_BG_COVER_MAX = 80;
/**
 * 화면에서 거는 값의 처음 값. 흐림은 지금 로그인 화면(봇 프로필 그림 배경)과 같다.
 * 덮개 35% 는 지금 로그인 화면이 봇 그림의 밝기를 띠 안으로 모으는 정도와 가깝다(회색 단계로 맞추면 어두운 모드 31% · 밝은 모드 39%)
 */
const LOGIN_BG_OPTIONS_DEFAULT: LoginBackgroundOptions = { blur: 0.5, cover: 35, follow: true, seam: { kind: "cut", seconds: 1 } };
/** 기록 · 저장 한도의 처음 값. maxBytes 0 이면 무제한 */
const LOGIN_BG_LIMITS_DEFAULT: LoginBackgroundLimits = { history: 5, maxBytes: 10 * 1024 ** 3 };
/** 기록 보관 개수의 상한 */
const LOGIN_BG_HISTORY_MAX = 50;
/** 굽기 전 어림을 넉넉히 잡는 몫(넘을 것 같으면 알리기만, 구운 뒤 실제 크기로 지킨다) */
const LOGIN_BG_ESTIMATE_MARGIN = 1.3;

/**
 * 만드는 단계. 앞의 셋은 편집 전, 나머지는 편집을 적용한 뒤다. 배경마다 해당하는 것만 한다.
 * receive 받기와 검사(형식 · 해상도 · 길이 · fps, 종류도 여기서 정한다, 유튜브는 480p) · preview 편집 창의 미리보기와 크기 어림 · strip 시간 막대 장면 띠(영상만) ·
 * highRes 고해상도 받기(유튜브만, 영상 전체) · thumb 썸네일(가장 작은 폭)과 대표색 · stills 나머지 폭 · tones 장면 바뀜과 장면 색(영상만) ·
 * h264 H.264 720p(영상만) · encode AV1 · VP9 단계 전부(영상만) · drop 원본 지우기와 한도 지키기.
 * 굽기(h264 · encode)는 봇 전체에서 한 번에 하나라 다른 배경을 굽는 동안 그 단계에서 차례를 기다린다. 나머지는 차례와 상관없이 한다
 */
const LOGIN_BG_STAGES = ["receive", "preview", "strip", "highRes", "thumb", "stills", "tones", "h264", "encode", "drop"] as const;
type LoginBackgroundStage = (typeof LOGIN_BG_STAGES)[number];
/** 편집 전 단계 */
const LOGIN_BG_BEFORE_EDIT: readonly LoginBackgroundStage[] = ["receive", "preview", "strip"];
/** 차례를 기다리는 굽기 단계 */
const LOGIN_BG_ENCODE_STAGES: readonly LoginBackgroundStage[] = ["h264", "encode"];
/** 배경 id(봇이 만드는 맞히기 어려운 값). 경로의 :id 는 이 꼴만 받는다 */
const LOGIN_BG_ID = /^[a-z0-9]{24}$/;

/** 화면에서 거는 값(CSS). blur 는 화면 폭의 %(기기마다 같은 정도로), cover 는 덮개 진하기 %, follow 는 영상 따라 테마 색(장면이 바뀔 때만) */
type LoginBackgroundOptions = { blur: number; cover: number; follow: boolean; seam: { kind: SeamKind; seconds: SeamSeconds } };
/** 꽉 채울 때 남길 곳(가로 · 세로 %, 0 ~ 100). 배경마다 */
type LoginBackgroundPosition = { x: number; y: number };

// ── 로그인 화면(로그인 전, 공개) ──

/** 폭별 그림 하나 */
type LoginBackgroundStill = { width: number; url: string };
/** HLS 단계 하나. codecs 는 RFC 6381 코덱 문자열, bandwidth 는 2초 최대(bps). 기기 판정(decodingInfo)에 그대로 넘긴다. HLS 목록의 값과 같은 기록에서 만든다 */
type LoginBackgroundRung = { width: number; height: number; codecs: string; bandwidth: number; frameRate: number };
/** 코덱 하나의 HLS 목록(url, 단계는 낮은 것부터). 코덱을 섞은 목록은 두지 않는다 */
type LoginBackgroundStream = { codec: LoginBackgroundCodec; url: string; rungs: LoginBackgroundRung[] };
/** 장면 하나. at 은 구운 영상의 처음부터 초, color 는 그 장면의 색(화면 색 체계의 바탕색 씨앗, #RRGGBB. 쓸 만한 색이 없으면 null = 회색 테마) */
type LoginBackgroundScene = { at: number; color: string | null };
/** 로그인 화면에 쓰는 것. 화면에서 거는 값과 지금 배경의 보일 자리 */
type LoginBackgroundLook = LoginBackgroundOptions & { position: LoginBackgroundPosition };
/**
 * GET /api/login-background(로그인 전, 캐시하지 않음, ETag). none 이면 봇 프로필 그림 배경.
 * 파일 주소는 /login-background/:id/… 이고 id 는 배경마다 달라: 폭별 그림 · 조각은 1년 immutable, HLS 목록(.m3u8)은 캐시하지 않는다.
 * 굽는 중이면 생긴 것만 싣는다(썸네일 → H.264 → AV1 · VP9). 보고 있는 화면은 받은 그대로 두고 다음 방문부터 더한 것을 쓴다.
 * stills 는 이미지면 그 그림, 영상이면 운영자가 고른 썸네일(첫 화면 · 마지막 폴백). color 는 대표색(장면 색과 같은 꼴, 없으면 null).
 * 원본 · 기록 목록 · 올린 파일 이름 · 받은 링크는 싣지 않는다
 */
type LoginBackground = { kind: "none" } | { kind: "image"; id: string; stills: LoginBackgroundStill[]; color: string | null; look: LoginBackgroundLook } | { kind: "video"; id: string; stills: LoginBackgroundStill[]; color: string | null; scenes: LoginBackgroundScene[]; streams: LoginBackgroundStream[]; look: LoginBackgroundLook };

// ── 운영자 패널 ──

/** 원본에서 쓸 사각형(0 ~ 1, x + w · y + h 는 1 이하) */
type LoginBackgroundCrop = { x: number; y: number; w: number; h: number };
/** 편집 창에서 정한 것. range 는 쓸 구간(초, 영상만), thumbAt 은 썸네일로 쓸 장면(초, 영상만, 구간 안) */
type LoginBackgroundEdit = { crop: LoginBackgroundCrop; range: [number, number] | null; thumbAt: number | null };
/**
 * 세트 크기 어림(편집 창의 예상 파일 크기 · 예상 인코딩 시간). 편집 전에만 싣는다.
 * 원본을 받을 때 원본 전체를 한 번 빠르게 구워 초마다의 세트 크기(perSecond, 그림은 빈다)를 둔다. 구간을 바꾸면 그 초를 더하기만 한다.
 * 크롭을 정하면 그 크롭 · 구간만 다시 센다: crop · counted 는 perSecond 를 잰 크롭과 구간(처음은 전체), counting 은 세는 중.
 * 고른 크롭이 crop 과 다르거나 구간이 counted 밖이면 화면이 다시 세게 한다. stillBytes 는 정지 그림 세트.
 * encodeRatio 는 영상 1초를 굽는 데 드는 초(이 기기에서 잰 어림의 속도에 미리 잰 세트 비율을 곱한 것).
 * rough 는 원본이 아닌 것으로 잰 어림(유튜브: 480p 로 재고 고해상도는 적용한 뒤에 받는다)
 */
type LoginBackgroundEstimate = { perSecond: number[]; stillBytes: number; crop: LoginBackgroundCrop; counted: [number, number] | null; counting: boolean; encodeRatio: number; rough: boolean };
/**
 * 배경이 있는 곳: preparing 편집 전 단계 · editing 편집을 기다림 · queued 굽기 차례를 기다림 · encoding 적용 뒤 단계 · ready 다 구움 ·
 * failed 실패(problem 에 까닭, 만든 것은 지우고 다시 올리게 한다)
 */
type LoginBackgroundPhase = "preparing" | "editing" | "queued" | "encoding" | "ready" | "failed";
/** 로그인 화면에 걸 수 있는 것: none 아직 없음 · thumb 썸네일 · partial 저화질 영상까지 · full 다 */
type LoginBackgroundShows = "none" | "thumb" | "partial" | "full";
/**
 * 배경 하나. from 은 올린 곳(유튜브는 다운로드 대행), name 은 올린 파일 이름 · 링크, at 은 올린 때 · usedAt 은 마지막으로 로그인 화면에 쓴 때(ms, 걸 때와 내릴 때 적는다).
 * bytes 는 지금 가진 파일 전부, width · height · duration · fps 는 원본(그림은 duration · fps 0).
 * stages 는 이 배경에 해당하는 단계, stage 는 지금 하는 단계(없으면 null) · progress 는 그 단계의 0 ~ 1, done 은 끝난 단계.
 * resumed 는 봇이 다시 켜져 끝난 단계는 두고 이어서 굽는 중. thumb 은 기록 줄에 띄울 가장 작은 정지 그림(아직 없으면 null).
 * strip 은 시간 막대 장면 띠(GET /:id/strip 의 WebP 한 장): count 장을 every 초 간격으로(장면은 그 구간의 가운데 즈음), columns 열 격자, 한 칸 width × height. estimate 는 미리보기 단계가 끝나고 편집을 적용하기 전까지
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
  thumb: string | null;
  strip: LoginBackgroundStrip | null;
  problem: Code | null;
  estimate: LoginBackgroundEstimate | null;
};
/** 시간 막대 장면 띠의 모양(LoginBackgroundItem.strip) */
type LoginBackgroundStrip = { count: number; every: number; columns: number; width: number; height: number };
/** 기록 · 저장 한도. history 는 지금 배경 말고 남겨 둘 다 구운 기록 수(0 ~ LOGIN_BG_HISTORY_MAX, 0 이면 지금 배경만), maxBytes 는 쓰는 배경과 기록을 합친 크기(0 이면 무제한) */
type LoginBackgroundLimits = { history: number; maxBytes: number };
/**
 * 코덱 하나를 굽는 인코더(봇이 켜질 때 작은 시험으로 고른다). encoder 는 ffmpeg 의 인코더 이름(없으면 null, 그 코덱은 굽지 않는다), hardware 는 GPU 인코더인가,
 * why 는 더 나은 인코더(하드웨어)를 못 쓰는 까닭 · 코덱을 못 굽는 까닭(ffmpeg 가 낸 그대로, 없으면 null)
 */
type LoginBackgroundEncoder = { codec: LoginBackgroundCodec; encoder: string | null; hardware: boolean; why: string | null };
/**
 * GET /api/admin/appearance/login-background 와 바꾸는 요청들의 답. 진행은 굽는 동안 이것을 다시 읽어 본다(운영자 패널의 상태 읽기와 같은 주기).
 * current 는 로그인 화면에 쓰는 배경. 새 배경은 썸네일이 생기면 current 가 되고, 그 전에는 쓰던 배경이 그대로다(없으면 봇 프로필 그림 배경).
 * previous 는 로그인 화면에 걸었던 것 중 current 를 빼고 마지막으로 쓴 것(인코딩 취소 때 돌아갈 곳).
 * shows 는 로그인 화면에 지금 걸린 것, list 는 만드는 배경 · 쓰는 배경 · 기록(새것부터). usedBytes 는 list 전부, freeBytes 는 저장 자리 디스크의 남은 크기.
 * encoders 는 코덱마다의 인코더, checking 은 인코더를 시험하는 중.
 * 한도는 굽기를 마칠 때 · 한도를 바꿀 때 지킨다: 다 구운 기록 중 current 를 뺀 것을 마지막으로 쓴 지 오래된 것부터 지운다(previous 는 맨 마지막).
 *
 * POST /upload?name=(본문은 파일 그대로) · POST /link { url } 은 새 배경을 만든다(편집 전 단계가 끝나면 editing).
 * GET /:id/preview 는 편집 창의 미리보기(영상 480p · 그림, 원본과 함께 지운다), GET /:id/strip 은 시간 막대 장면 띠.
 * 카드 화면 판은 공개 파일(썸네일 · H.264 720p)이 생기면 그것을, 그 전에는 미리보기를 띄운다.
 * PUT /:id/estimate { crop, range } 은 그 크롭 · 구간으로 다시 센다. PUT /:id/edit LoginBackgroundEdit 는 편집을 적용해 굽는다(editing 일 때만, 한 번만).
 * PUT /:id/position LoginBackgroundPosition. POST /:id/cancel 은 편집 취소 · 인코딩 취소이고, DELETE /:id(기록에서 지우기)도 만드는 중이면 같다.
 * PUT /current { id } 는 다 구운 기록으로 갈아 끼우고, DELETE /current 는 비운다(기록은 남김).
 * PUT /options LoginBackgroundOptions · PUT /limits LoginBackgroundLimits.
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
  checking: boolean;
};

export { LOGIN_BG_WIDTHS, LOGIN_BG_CODECS, SEAM_KINDS, SEAM_SECONDS, LOGIN_BG_BLUR_MAX, LOGIN_BG_COVER_MAX, LOGIN_BG_OPTIONS_DEFAULT, LOGIN_BG_LIMITS_DEFAULT, LOGIN_BG_HISTORY_MAX, LOGIN_BG_ESTIMATE_MARGIN, LOGIN_BG_STAGES, LOGIN_BG_BEFORE_EDIT, LOGIN_BG_ENCODE_STAGES, LOGIN_BG_ID };
export type { LoginBackgroundCodec, SeamKind, SeamSeconds, LoginBackgroundOptions, LoginBackgroundPosition, LoginBackgroundStill, LoginBackgroundRung, LoginBackgroundStream, LoginBackgroundScene, LoginBackgroundLook, LoginBackground, LoginBackgroundCrop, LoginBackgroundEdit, LoginBackgroundEstimate, LoginBackgroundPhase, LoginBackgroundShows, LoginBackgroundStage, LoginBackgroundItem, LoginBackgroundStrip, LoginBackgroundLimits, LoginBackgroundEncoder, LoginBackgroundState };
