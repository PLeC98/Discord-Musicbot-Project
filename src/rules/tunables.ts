// 운영 조절값. 대시보드(운영자 패널의 일반 · 유튜브 · 디스플레이 탭, GROUP_TAB)에서 고치고 settings.db 의 "tunables" 문서에 둔다(옛 .env 의 같은 이름).
// 값은 .env 와 같은 글자로 둔다. 읽는 길(config 의 envReaders)이 하나라 검사 · 단위 바꾸기 · 다듬기가 .env 때와 같다.
// 화면도 부르므로 Node 없는 모듈이다. 이름표 · 설명은 화면 문구표(dashboard/src/text/ko/tunables.ts)에 있다.
//
// restart: 기동 때 한 번 잡는 값. 저장해도 다시 켜기 전까지는 기동 때 값으로 돈다(반쯤 먹는 일이 없게. store/tunables).
// 나머지는 저장하면 바로 먹는다. 기동 때 만들어 둔 것(요청 제한기 · 하트비트 · 캐시 정리 타이머 · 클라이언트 표)은 바뀐 것을 듣고 다시 만든다

/** 묶음(화면의 카드 차례) */
const TUNABLE_GROUPS = ["queue", "look", "youtube", "sponsorblock", "cache", "stream", "dashboard"] as const;
type TunableGroup = (typeof TUNABLE_GROUPS)[number];

/**
 * 칸의 꼴. int: 정수(min · max), bool: true · false, text: 글자, color: #RRGGBB, url: http · https 주소,
 * list: 쉼표로 나눈 이름들, cookies: file 또는 브라우저 이름
 */
type TunableKind = "int" | "bool" | "text" | "color" | "url" | "list" | "cookies" | "categories";

type Tunable = { key: string; group: TunableGroup; kind: TunableKind; def: string; min?: number; max?: number; restart?: boolean };

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
  { key: "YTDLP_PLAYER_CLIENTS", group: "youtube", kind: "list", def: "" },
  { key: "YTDLP_CLIENT_WINDOW", group: "youtube", kind: "int", def: "5", min: 2, max: 50 },
  { key: "YTDLP_CLIENT_FAILS", group: "youtube", kind: "int", def: "3", min: 1, max: 50 },
  { key: "YTDLP_CLIENT_RETRY_MINUTES", group: "youtube", kind: "int", def: "60", min: 0, max: 10080 },
  { key: "COOKIES_SOURCE", group: "youtube", kind: "cookies", def: "" },
  { key: "BGUTIL_ENABLED", group: "youtube", kind: "bool", def: "false", restart: true },
  // SponsorBlock
  { key: "SPONSORBLOCK_ENABLED", group: "sponsorblock", kind: "bool", def: "true", restart: true },
  { key: "SPONSORBLOCK_API_BASE", group: "sponsorblock", kind: "url", def: "https://sponsor.ajay.app" },
  { key: "SPONSORBLOCK_HASH_PREFIX", group: "sponsorblock", kind: "int", def: "5", min: 4, max: 32 },
  { key: "SPONSORBLOCK_TIMEOUT_MS", group: "sponsorblock", kind: "int", def: "1000", min: 100, max: 10000 },
  // 화면은 체크박스 목록(카드 폭 전체라 묶음 맨 끝). 쉼표로 이은 구간 id, 하나도 고르지 않으면 NO_CATEGORIES
  { key: "SPONSORBLOCK_CATEGORIES", group: "sponsorblock", kind: "categories", def: "music_offtopic,intro,outro" },
  // 오디오 캐시
  { key: "CACHE_MAX_SIZE_MB", group: "cache", kind: "int", def: "1024", min: 1, max: 1048576 },
  { key: "CACHE_MAX_FILES", group: "cache", kind: "int", def: "500", min: 1, max: 1000000 },
  { key: "CACHE_MIN_FREE_DISK_MB", group: "cache", kind: "int", def: "2048", min: 0, max: 1048576 },
  { key: "CACHE_EVICT_TARGET_PERCENT", group: "cache", kind: "int", def: "90", min: 50, max: 99 },
  { key: "CACHE_EVICT_INTERVAL_HOURS", group: "cache", kind: "int", def: "4", min: 1, max: 168 },
  { key: "CACHE_MAX_TRACK_MINUTES", group: "cache", kind: "int", def: "60", min: 0, max: 10080 },
  // 재생 스트림
  { key: "STREAM_CHUNK_KB", group: "stream", kind: "int", def: "1024", min: 64, max: 65536 },
  // 대시보드 요청 제한 · 실시간 연결
  { key: "RATE_LIMIT_WINDOW_SEC", group: "dashboard", kind: "int", def: "60", min: 1, max: 3600 },
  { key: "RATE_LIMIT_API_MAX", group: "dashboard", kind: "int", def: "120", min: 1, max: 100000 },
  { key: "RATE_LIMIT_QUEUE_MAX", group: "dashboard", kind: "int", def: "20", min: 1, max: 100000 },
  { key: "RATE_LIMIT_AUTH_WINDOW_SEC", group: "dashboard", kind: "int", def: "600", min: 1, max: 86400 },
  { key: "RATE_LIMIT_AUTH_MAX", group: "dashboard", kind: "int", def: "30", min: 1, max: 100000 },
  { key: "SSE_HEARTBEAT_SEC", group: "dashboard", kind: "int", def: "20", min: 5, max: 300 },
  { key: "SSE_MAX_CONNECTIONS", group: "dashboard", kind: "int", def: "5", min: 1, max: 100 },
  { key: "SSE_COALESCE_MS", group: "dashboard", kind: "int", def: "300", min: 0, max: 5000 },
];

/** 묶음을 둘 운영자 패널 탭(id): 표시는 디스플레이, 유튜브 · SponsorBlock 은 유튜브, 나머지는 설정. 화면은 탭마다 그 묶음만 그린다 */
type TunableTab = "settings" | "appearance" | "youtube";
const GROUP_TAB: Readonly<Record<TunableGroup, TunableTab>> = { queue: "settings", look: "appearance", youtube: "youtube", sponsorblock: "youtube", cache: "settings", stream: "settings", dashboard: "settings" };
const groupsIn = (tab: TunableTab) => TUNABLE_GROUPS.filter((group) => GROUP_TAB[group] === tab);

const TUNABLE_KEYS: ReadonlySet<string> = new Set(TUNABLES.map((one) => one.key));
const RESTART_KEYS: ReadonlySet<string> = new Set(TUNABLES.filter((one) => one.restart).map((one) => one.key));

/**
 * 저장할 꼴. 글 칸(text: 음성 상태 머리말 등)은 앞뒤 공백도 값이다("📻 " 뒤에 곡 이름이 붙는다). 나머지는 앞뒤 공백을 걷는다.
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

/** 대시보드의 답. values: 저장한 값(비운 칸은 없다 = 기본값), revision: 저장 번호, pending: 저장했지만 다시 켜야 먹는 이름 */
type TunablesView = { values: Record<string, string>; revision: number; pending: string[] };

export { TUNABLES, TUNABLE_GROUPS, GROUP_TAB, TUNABLE_KEYS, RESTART_KEYS, groupsIn, tunable, tunableValue };
export type { Tunable, TunableGroup, TunableKind, TunableTab, TunablesView };
