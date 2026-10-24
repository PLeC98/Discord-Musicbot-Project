// 운영 조절값. 대시보드(운영자 패널의 일반 · 유튜브 · 연령 제한 · 디스플레이 탭, GROUP_TAB)에서 고치고 settings.db 의 "tunables" 문서에 둔다.
// 이름 · 값은 .env 값과 같은 모양(대문자 이름 · 글자 값)이다. 읽는 길(config 의 envReaders)이 하나라 검사 · 단위 바꾸기 · 다듬기가 .env 값과 같다.
// 화면도 부르므로 Node 없는 모듈이다. 라벨 · 설명은 화면 문구표(dashboard/src/text/ko/tunables.ts)에 있다.
//
// restart: 기동 때 한 번 잡는 값. 저장해도 다시 시작하기 전까지는 기동 때 값으로 돈다(반쯤 적용되는 일이 없게. store/tunables).
// 나머지는 저장하면 바로 적용된다. 기동 때 만들어 둔 것(요청 제한기 · 하트비트 · 캐시 정리 타이머 · 클라이언트 표)은 바뀐 것을 듣고 다시 만든다
// advanced: 동작을 알아야 고치는 값. 운영자 패널은 "고급 설정 보기"를 켰을 때만 보인다
// box: 카드 안에서 한 박스로 묶어 그리는 항목들(같은 일의 출처별 값)

/** 그룹(화면의 카드 순서) */
const TUNABLE_GROUPS = ["queue", "look", "youtube", "sponsorblock", "ageyoutube", "cache", "stream", "geoip", "dashboard", "ailog"] as const;
type TunableGroup = (typeof TUNABLE_GROUPS)[number];

/**
 * 필드의 형식. int: 정수(min · max), bool: true · false, text: 문자열, color: #RRGGBB, url: http · https 주소,
 * list: 쉼표로 나눈 이름들, cookies: file 또는 브라우저 이름
 */
type TunableKind = "int" | "bool" | "text" | "color" | "url" | "list" | "cookies" | "categories";

/** 카드 안의 박스. recheck: 원본 다시 확인 간격(출처별) */
type TunableBox = "recheck";

type Tunable = { key: string; group: TunableGroup; kind: TunableKind; def: string; min?: number; max?: number; restart?: boolean; advanced?: boolean; box?: TunableBox };

const TUNABLES: readonly Tunable[] = [
  // 대기열 · 나가기
  { key: "QUEUE_MAX_TRACKS", group: "queue", kind: "int", def: "250", min: 0 },
  { key: "LEAVE_DELAY_QUEUE_EMPTY_SECONDS", group: "queue", kind: "int", def: "600", min: 0, max: 86400 },
  { key: "LEAVE_DELAY_ALONE_SECONDS", group: "queue", kind: "int", def: "120", min: 0, max: 86400 },
  // 표시
  { key: "EMBED_COLOR", group: "look", kind: "color", def: "#2743D2" },
  { key: "WEBSITE", group: "look", kind: "url", def: "" },
  { key: "VOICE_PLAYING_PREFIX", group: "look", kind: "text", def: "" },
  { key: "VOICE_PAUSED_PREFIX", group: "look", kind: "text", def: "" },
  { key: "VOICE_IDLE_STATUS", group: "look", kind: "text", def: "" },
  // 유튜브
  { key: "BGUTIL_ENABLED", group: "youtube", kind: "bool", def: "false", restart: true },
  { key: "YTDLP_PLAYER_CLIENTS", group: "youtube", kind: "list", def: "", advanced: true },
  { key: "YTDLP_CLIENT_WINDOW", group: "youtube", kind: "int", def: "5", min: 2, max: 50, advanced: true },
  { key: "YTDLP_CLIENT_FAILS", group: "youtube", kind: "int", def: "3", min: 1, max: 50, advanced: true },
  { key: "YTDLP_CLIENT_RETRY_MINUTES", group: "youtube", kind: "int", def: "60", min: 0, max: 10080, advanced: true },
  // 동시에 도는 yt-dlp. 0 이면 메모리로 정한다
  { key: "YTDLP_LOOKUP_SLOTS", group: "youtube", kind: "int", def: "0", min: 0, max: 32, advanced: true },
  { key: "YTDLP_BACKGROUND_SLOTS", group: "youtube", kind: "int", def: "0", min: 0, max: 32, advanced: true },
  // 연령 제한 영상을 받을 때만 쓰는 쿠키. 연령 제한 콘텐츠를 켰을 때만 쓰고 보인다(config/age-content)
  { key: "COOKIES_SOURCE", group: "ageyoutube", kind: "cookies", def: "" },
  // SponsorBlock
  { key: "SPONSORBLOCK_ENABLED", group: "sponsorblock", kind: "bool", def: "true", restart: true },
  { key: "SPONSORBLOCK_API_BASE", group: "sponsorblock", kind: "url", def: "https://sponsor.ajay.app", advanced: true },
  { key: "SPONSORBLOCK_HASH_PREFIX", group: "sponsorblock", kind: "int", def: "5", min: 4, max: 32, advanced: true },
  { key: "SPONSORBLOCK_TIMEOUT_MS", group: "sponsorblock", kind: "int", def: "1000", min: 100, max: 10000, advanced: true },
  // 화면은 체크박스 목록(카드 폭 전체라 그룹 맨 끝). 쉼표로 이은 구간 id, 하나도 선택하지 않으면 NO_CATEGORIES
  { key: "SPONSORBLOCK_CATEGORIES", group: "sponsorblock", kind: "categories", def: "music_offtopic,intro,outro" },
  // 오디오 캐시
  { key: "CACHE_MAX_SIZE_MB", group: "cache", kind: "int", def: "1024", min: 1, max: 1048576 },
  { key: "CACHE_MAX_FILES", group: "cache", kind: "int", def: "500", min: 1, max: 1000000 },
  { key: "CACHE_MIN_FREE_DISK_MB", group: "cache", kind: "int", def: "2048", min: 0, max: 1048576 },
  { key: "CACHE_MAX_TRACK_MINUTES", group: "cache", kind: "int", def: "60", min: 0, max: 10080 },
  { key: "CACHE_EVICT_TARGET_PERCENT", group: "cache", kind: "int", def: "90", min: 50, max: 99, advanced: true },
  { key: "CACHE_EVICT_INTERVAL_HOURS", group: "cache", kind: "int", def: "4", min: 1, max: 168, advanced: true },
  // 캐시로 튼 곡의 원본을 다시 묻는 간격(일, 0 이면 묻지 않는다). 묻기의 값 · 바뀌었을 때 할 일이 출처마다 달라 따로
  { key: "CACHE_RECHECK_YOUTUBE_DAYS", group: "cache", kind: "int", def: "90", min: 0, max: 3650, advanced: true, box: "recheck" },
  { key: "CACHE_RECHECK_SOUNDCLOUD_DAYS", group: "cache", kind: "int", def: "30", min: 0, max: 3650, advanced: true, box: "recheck" },
  { key: "CACHE_RECHECK_DIRECT_DAYS", group: "cache", kind: "int", def: "14", min: 0, max: 3650, advanced: true, box: "recheck" },
  // 재생 스트림
  { key: "STREAM_CHUNK_KB", group: "stream", kind: "int", def: "1024", min: 64, max: 65536, advanced: true },
  // IP 위치 DB(로그인한 기기의 위치, DB-IP City Lite). 자동 업데이트는 매달 새 버전을 받는다
  { key: "GEOIP_ENABLED", group: "geoip", kind: "bool", def: "true" },
  { key: "GEOIP_AUTO_UPDATE", group: "geoip", kind: "bool", def: "true" },
  // 대시보드 요청 제한 · 실시간 연결
  { key: "RATE_LIMIT_WINDOW_SEC", group: "dashboard", kind: "int", def: "60", min: 1, max: 3600, advanced: true },
  { key: "RATE_LIMIT_API_MAX", group: "dashboard", kind: "int", def: "120", min: 1, max: 100000, advanced: true },
  { key: "RATE_LIMIT_QUEUE_MAX", group: "dashboard", kind: "int", def: "20", min: 1, max: 100000, advanced: true },
  { key: "RATE_LIMIT_PUBLIC_MAX", group: "dashboard", kind: "int", def: "1000", min: 1, max: 100000, advanced: true },
  { key: "RATE_LIMIT_AUTH_WINDOW_SEC", group: "dashboard", kind: "int", def: "600", min: 1, max: 86400, advanced: true },
  { key: "RATE_LIMIT_AUTH_MAX", group: "dashboard", kind: "int", def: "30", min: 1, max: 100000, advanced: true },
  { key: "SSE_HEARTBEAT_SEC", group: "dashboard", kind: "int", def: "20", min: 5, max: 300, advanced: true },
  { key: "SSE_MAX_CONNECTIONS", group: "dashboard", kind: "int", def: "5", min: 1, max: 100, advanced: true },
  { key: "SSE_COALESCE_MS", group: "dashboard", kind: "int", def: "300", min: 0, max: 5000, advanced: true },
  // AI 리퀘스트 로그(AI 보조 탭의 리퀘스트 로그 화면). 끄면 사용량 통계도 멈춘다. 용량을 넘으면 오래된 로그부터 삭제한다(통계는 남는다)
  { key: "AI_LOG_ENABLED", group: "ailog", kind: "bool", def: "true", advanced: true },
  { key: "AI_LOG_MAX_MB", group: "ailog", kind: "int", def: "64", min: 1, max: 10240, advanced: true },
];

/** 그룹을 둘 운영자 패널 탭(id): 표시는 디스플레이, 유튜브 · SponsorBlock 은 유튜브, 연령 제한 콘텐츠의 쿠키는 연령 제한, AI 리퀘스트 로그는 AI 보조, 나머지는 설정. 화면은 탭마다 그 그룹만 그린다 */
type TunableTab = "settings" | "appearance" | "youtube" | "age" | "ai";
const GROUP_TAB: Readonly<Record<TunableGroup, TunableTab>> = { queue: "settings", look: "appearance", youtube: "youtube", sponsorblock: "youtube", ageyoutube: "age", cache: "settings", stream: "settings", geoip: "settings", dashboard: "settings", ailog: "ai" };
const groupsIn = (tab: TunableTab) => TUNABLE_GROUPS.filter((group) => GROUP_TAB[group] === tab);

const TUNABLE_KEYS: ReadonlySet<string> = new Set(TUNABLES.map((one) => one.key));
const RESTART_KEYS: ReadonlySet<string> = new Set(TUNABLES.filter((one) => one.restart).map((one) => one.key));

/**
 * 저장할 형식. 텍스트 필드(text: 음성 상태 접두어 등)는 앞뒤 공백도 값이다("📻 " 뒤에 곡 이름이 붙는다). 나머지는 앞뒤 공백을 제거한다.
 * 공백뿐이면 빈 값(기본값)이다
 */
function tunableValue(key: string, raw: string): string {
  if (!raw.trim()) return "";
  return TUNABLES.find((one) => one.key === key)?.kind === "text" ? raw : raw.trim();
}

/** 이름으로 찾는다. 모르는 이름이면 던진다(코드의 오타다) */
function tunable(key: string): Tunable {
  const found = TUNABLES.find((one) => one.key === key);
  if (!found) throw new Error(`모르는 조절값: ${key}`);
  return found;
}

/** 대시보드의 답. values: 저장한 값(비운 필드는 없다 = 기본값), revision: 저장 번호, pending: 저장했지만 다시 시작해야 적용되는 이름 */
type TunablesView = { values: Record<string, string>; revision: number; pending: string[] };

export { TUNABLES, TUNABLE_GROUPS, GROUP_TAB, TUNABLE_KEYS, RESTART_KEYS, groupsIn, tunable, tunableValue };
export type { TunableBox, Tunable, TunableGroup, TunableKind, TunableTab, TunablesView };
