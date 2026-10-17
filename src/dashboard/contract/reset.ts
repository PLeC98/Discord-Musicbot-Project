// 초기화(운영자 패널 백업 · 초기화 탭의 초기화 카드). /api/admin/reset. 봇과 화면이 같이 읽으므로 Node 를 부르지 않는다.
// 휴대폰의 "설정 초기화 · 기기 전체 초기화"처럼 무엇을 지우는지로 나눈 줄 다섯. 모두 최근 로그인을 본다(여러 항목을 되돌릴 수 없게 한꺼번에 지운다).
// 설정이 바뀌는 줄(봇 설정 · 서버별 설정 · 봇 전체)은 바꾸기 전에 설정 스냅샷(before-reset)을 남긴다.
// 봇 전체 초기화는 켜진 채 지우지 않는다: 표지를 걸고 다시 시작해 다음 기동이 DB 를 열기 전에 지운다(사람이 누른 것만, 구조 버전 멈춤과 무관).

/**
 * audio-cache: 오디오 캐시(확인 창에서 고른 것) · bot-settings: 봇 설정(운영 조절값 · 장르 · 상태 문구 · AI 설정 · 프롬프트를 기본값으로, 키 · 쿠키를 지움) ·
 * guild-settings: 모든 서버의 서버별 설정 · display: 파비콘 · 로그인 배경(기록 · 화면 값 · 한도까지) · all: 봇 전체(.env · vendor · 설정 스냅샷 · 로그를 뺀 전부)
 */
const RESET_KINDS = ["audio-cache", "bot-settings", "guild-settings", "display", "all"] as const;
type ResetKind = (typeof RESET_KINDS)[number];
const isResetKind = (value: unknown): value is ResetKind => RESET_KINDS.includes(value as ResetKind);

/** 오디오 캐시 초기화에서 고르는 것: 받은 곡(파일까지) · 곡 찾기 기록(장부 · 재생 확인 결과) · 바깥 서비스 기억(SponsorBlock · 연령 제한 · 스포티파이 익명) · 정한 음원 */
const AUDIO_CACHE_PARTS = ["files", "ledger", "external", "pins"] as const;
type AudioCachePart = (typeof AUDIO_CACHE_PARTS)[number];
/** 처음 고른 것(정한 음원은 사람이 고른 것이라 꺼 둔다) */
const AUDIO_CACHE_PARTS_DEFAULT: readonly AudioCachePart[] = ["files", "ledger", "external"];

/** 초기화 요청(POST /api/admin/reset). all 은 봇 이름을 그대로 쳐야 받는다 */
type ResetRequest = { kind: "audio-cache"; parts: AudioCachePart[] } | { kind: "bot-settings" | "guild-settings" | "display" } | { kind: "all"; confirmName: string };

/** 카드가 줄마다 보이는 지금 양(GET /api/admin/reset). 확인 창이 "무엇이 지워지는지"를 숫자로 보인다 */
type ResetOverview = {
  audioCache: { files: number; bytes: number; ledger: number; pins: number; external: number };
  botSettings: { changedTunables: number; documents: number; secrets: number };
  guildSettings: { guilds: number };
  display: { favicons: number; backgrounds: number };
  /** 봇 전체 초기화가 걸려 있다(다음 기동에 지운다). 거두기는 DELETE /api/admin/reset/staged */
  staged: boolean;
};

/**
 * 초기화의 답. kind 마다 지운 것. snapshot 은 바꾸기 전에 남긴 설정 스냅샷 이름(되돌릴 곳).
 * restart: 다시 켜야 먹는 값이 바뀌었다(화면이 "지금 다시 시작 · 나중에" 창을 연다)
 */
type ResetDone = { kind: "audio-cache"; removedFiles: number; freedBytes: number; keptFiles: number; cleared: Partial<Record<AudioCachePart, number>> } | { kind: "bot-settings"; snapshot: string; restart: boolean } | { kind: "guild-settings"; snapshot: string; guilds: number } | { kind: "display"; favicons: number; backgrounds: number } | { kind: "all"; snapshot: string; restartNow: boolean };

export { RESET_KINDS, AUDIO_CACHE_PARTS, AUDIO_CACHE_PARTS_DEFAULT, isResetKind };
export type { ResetKind, AudioCachePart, ResetRequest, ResetOverview, ResetDone };
