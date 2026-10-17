// 캐시 DB(운영자 패널 "캐시 DB" 탭)의 모양. /api/admin/track-cache. 봇과 화면이 같이 읽으므로 Node 를 부르지 않는다.
// 겉은 DB Browser for SQLite 의 데이터 보기를 본뜨지만 날 표가 아니다: 표 셋(요청 · 받은 파일 · 연령 제한)은 이 화면의 표이고(cache.db 의 표를 봇이 이어 붙인다),
// 칸 편집은 정해진 조작(TrackCacheOp)으로 바꿔 보낸다. 서버는 칸 이름을 받지 않는다.
// 읽기는 표 하나의 구간(거르기 · 정렬은 서버가), 쓰기는 조작 목록을 한 번에(모두 검사한 뒤 조작마다 결과), 재생 확인은 바로 하는 일이라 따로 줄에 세운다.

const TRACK_CACHE_TABLES = ["requests", "files", "age"] as const;
type TrackCacheTable = (typeof TRACK_CACHE_TABLES)[number];
const isTrackCacheTable = (value: unknown): value is TrackCacheTable => TRACK_CACHE_TABLES.includes(value as TrackCacheTable);

/** 표마다의 칸(화면의 처음 차례). 거르기 · 정렬은 이 이름으로만 받는다 */
const TRACK_CACHE_COLUMNS = {
  requests: ["requestKey", "platform", "title", "artist", "audioUrl", "pinned", "file", "size", "plays", "lastPlayedAt", "ageRestricted", "check"],
  files: ["audioKey", "audioUrl", "title", "channel", "status", "size", "duration", "plays", "lastPlayedAt", "downloadedAt"],
  age: ["videoId", "markedAt"],
} as const satisfies Record<TrackCacheTable, readonly string[]>;
type TrackCacheColumn<T extends TrackCacheTable = TrackCacheTable> = (typeof TRACK_CACHE_COLUMNS)[T][number];
const isTrackCacheColumn = <T extends TrackCacheTable>(table: T, value: unknown): value is TrackCacheColumn<T> => (TRACK_CACHE_COLUMNS[table] as readonly unknown[]).includes(value);

/** 처음 정렬(머리에 표시한다) */
const TRACK_CACHE_DEFAULT_SORT: { [T in TrackCacheTable]: TrackCacheSort<T> } = {
  requests: [{ column: "lastPlayedAt", dir: "desc" }],
  files: [{ column: "lastPlayedAt", dir: "desc" }],
  age: [{ column: "markedAt", dir: "desc" }],
};

/** 한 번에 읽는 줄 수 상한 */
const TRACK_CACHE_PAGE_MAX = 200;
/** 칸 하나의 거르기 식 길이 상한 · 그 안의 정규식 길이 상한(서버가 음악 재생과 같은 이벤트 루프에서 거른다) */
const TRACK_CACHE_FILTER_MAX = 200;
const TRACK_CACHE_REGEX_MAX = 100;
/** 한 번에 쓰는 조작 · 그중 파일 지우기 상한 */
const TRACK_CACHE_OPS_MAX = 200;
const TRACK_CACHE_FILE_DELETES_MAX = 100;
/** 재생 확인을 한 번에 세우는 수 상한 */
const TRACK_CACHE_PROBE_MAX = 20;

// ── 줄 ──────────────────────────────────────────────────────────────────────

/** 받은 파일의 상태. none: 행이 없다(밀려났거나 받은 적 없음) */
type TrackFileStatus = "cached" | "downloading" | "error" | "none";

/** 재생 확인 결과. code 는 실패한 까닭(문제 코드, 라이브면 "live"). 운영자가 누른 확인과 정한 음원이 틀다 죽은 것이 같은 자리에 남는다 */
type TrackCheck = { ok: boolean; code: string | null; at: number };

/**
 * 요청 표의 한 줄: 요청 하나(장부 줄 ∪ 정한 음원. 정한 음원은 장부에 없어도 줄이 있다).
 * 받은 파일 · 크기 · 재생 수 · 마지막 재생 · 연령 제한 · 확인은 쓰는 음원(audioUrl)의 음원 키로 이어 붙인 것이라, 이을 것이 없으면 null(화면은 "—")
 */
type TrackRequestRow = {
  /** 원래 링크(장부의 열쇠, canonicalUrl) 또는 자동재생 키(amq: · at: 등) */
  requestKey: string;
  platform: string;
  title: string | null;
  artist: string | null;
  /** 쓰는 음원: 정했으면 정한 것, 아니면 장부의 자동 결과 */
  audioUrl: string | null;
  /** 장부의 자동 결과(정했어도 둔다: 풀면 돌아갈 곳). 장부 줄이 없으면 null */
  ledgerAudioUrl: string | null;
  /** 정한 음원 주소 · 정한 때. 정하지 않았으면 null */
  pinned: { audioUrl: string; at: number } | null;
  /** 쓰는 음원의 음원 키(yt: · sc: · dl:). 셀 수 없는 주소면 null */
  audioKey: string | null;
  file: TrackFileStatus;
  size: number | null;
  plays: number | null;
  lastPlayedAt: number | null;
  ageRestricted: boolean;
  check: TrackCheck | null;
  /** 같은 받은 파일을 쓰는 요청 수(나 포함). 받은 파일을 지우면 이만큼이 함께 바뀐다 */
  sharedBy: number;
};

/** 받은 파일 표의 한 줄: audio_cache 의 줄. 요청이 가리키지 않는 파일도 있다(requests 0) */
type TrackFileRow = {
  audioKey: string;
  /** 음원 주소. 유튜브 · 사운드클라우드는 키에서 다시 만들고, 직접 링크(dl:)는 가리키는 장부 줄에서 온다(없으면 null) */
  audioUrl: string | null;
  title: string | null;
  channel: string | null;
  status: Exclude<TrackFileStatus, "none">;
  size: number | null;
  duration: number | null;
  plays: number;
  lastPlayedAt: number | null;
  downloadedAt: number | null;
  /** 이 파일을 쓰는 요청 수 */
  requests: number;
};

/** 연령 제한 표의 한 줄 */
type TrackAgeRow = { videoId: string; markedAt: number };

type TrackCacheRow<T extends TrackCacheTable = TrackCacheTable> = { requests: TrackRequestRow; files: TrackFileRow; age: TrackAgeRow }[T];

// ── 읽기(GET /api/admin/track-cache) ───────────────────────────────────────

type TrackCacheSort<T extends TrackCacheTable = TrackCacheTable> = Array<{ column: TrackCacheColumn<T>; dir: "asc" | "desc" }>;

/**
 * 읽기. filters 는 칸마다 DB Browser for SQLite 의 거르기 식 그대로(그냥 쓰면 포함 · = · <> · > < >= <= · a~b · /정규식/ · ='' · <>'',
 * 크기는 10MB 같은 단위 · 때는 2026-10-17 같은 날짜도), q 는 아무 칸에서나(낱말마다 어느 칸에든 들어간 줄). 칸끼리는 AND.
 * 정렬은 고른 칸 다음에 그 표의 열쇠를 끝 기준으로 붙여 같은 값의 줄이 흔들리지 않는다
 */
type TrackCacheQuery<T extends TrackCacheTable = TrackCacheTable> = {
  table: T;
  filters: Partial<Record<TrackCacheColumn<T>, string>>;
  q: string;
  sort: TrackCacheSort<T>;
  offset: number;
  limit: number;
};

/**
 * 읽은 구간. total: 그 표의 전부 · matched: 거르기에 맞는 것. revision 은 이 표들을 쓰는 함수가 올리는 바뀜 번호(다르면 화면이 "봇이 바꾼 줄이 있어요" 알약),
 * checkRevision 은 재생 확인 결과의 번호(운영자가 누른 확인은 알약을 띄우지 않게 따로)
 */
type TrackCachePage<T extends TrackCacheTable = TrackCacheTable> = {
  table: T;
  rows: Array<TrackCacheRow<T>>;
  offset: number;
  total: number;
  matched: number;
  revision: number;
  checkRevision: number;
};

/** 읽기를 주소 질의로: f.<칸>=식 · q · sort=<칸>:asc,<칸>:desc · offset · limit */
function trackCacheSearch<T extends TrackCacheTable>(query: TrackCacheQuery<T>): URLSearchParams {
  const search = new URLSearchParams({ table: query.table, q: query.q, offset: String(query.offset), limit: String(query.limit) });
  for (const [column, expr] of Object.entries(query.filters) as Array<[string, string | undefined]>) if (expr) search.set(`f.${column}`, expr);
  if (query.sort.length) search.set("sort", query.sort.map((one) => `${one.column}:${one.dir}`).join(","));
  return search;
}

// ── 쓰기(POST /api/admin/track-cache) ──────────────────────────────────────

/**
 * 조작 하나. expect 는 화면이 본 값(그사이 봇이 바꿨으면 그 조작은 "changed" 로 막힌다). 봇이 늘 다시 쓰는 칸(재생 수 · 마지막 재생)은 견주지 않는다.
 * pin: 정한 음원으로(새 줄도 이것) · unpin: 정한 음원 풀기 · clearResult: 장부의 자동 결과 지우기(다음에 다시 찾는다) ·
 * deleteRequest: 장부 줄과 정한 음원 지우기 · deleteFile: 받은 파일 지우기(파일 없는 error 줄은 줄만) · clearAge: 연령 제한 표시 지우기
 */
type TrackCacheOp = { op: "pin"; requestKey: string; audioUrl: string; expect: string | null } | { op: "unpin"; requestKey: string; expect: string } | { op: "clearResult"; requestKey: string; expect: string } | { op: "deleteRequest"; requestKey: string; expect: { ledgerAudioUrl: string | null; pinned: string | null } } | { op: "deleteFile"; audioKey: string; expect: number | null } | { op: "clearAge"; videoId: string; expect: number };
type TrackCacheOpName = TrackCacheOp["op"];

/** 쓰기. 먼저 모두 검사한다: 하나라도 틀리면 400(errors 의 pointer 가 /ops/<번호>/<칸>) · 아무것도 쓰지 않는다 */
type TrackCacheWrite = { ops: TrackCacheOp[] };

/** 파일을 쓰는 곳: 재생 중 · 대기열 앞(미리 받기 몫) · 저장 세션 앞 · 내보내는 중 */
type TrackFileUse = "playing" | "queued" | "saved-session" | "exporting";

/**
 * 조작 하나의 결과. 모두 되거나 모두 안 됨으로 묶지 않는다(조작끼리 서로 기대지 않고, 지운 파일은 되돌릴 수 없다).
 * changed: 화면이 본 값과 지금 값이 다르다(current 에 지금 값) · gone: 가리킨 줄이 없다 · in-use: 쓰는 중이라 지우지 않았다 ·
 * downloading: 받는 중이다 · locked: 파일이 잠겨 지우지 못했다(Windows)
 */
type TrackCacheOpResult = { ok: true } | { ok: false; code: "changed"; current: unknown } | { ok: false; code: "gone" } | { ok: false; code: "in-use"; where: TrackFileUse } | { ok: false; code: "downloading" } | { ok: false; code: "locked" };

/** 쓰기의 답. results 는 조작 차례 그대로. 화면은 실패한 것을 바뀐 채 두고 다시 읽는다 */
type TrackCacheWritten = { results: TrackCacheOpResult[]; revision: number };

// ── 재생 확인 ───────────────────────────────────────────────────────────────

/** 재생 확인 세우기(POST /api/admin/track-cache/probe). 쓰기 전의 값이면 그 주소로. 곧바로 돌아오고 봇이 하나씩 차례로 한다 */
type TrackCacheProbe = { audioUrls: string[] };
/** 세운 것: queued 새로 세움 · already 이미 줄에 있음 */
type TrackCacheProbeQueued = { queued: number; already: number };

/** 바뀜 번호(GET /api/admin/track-cache/revision). 탭이 보이는 동안 운영자 패널의 3초 읽기가 이것만 본다. checking: 확인을 기다리거나 하는 중인 음원 키 */
type TrackCacheRevision = { revision: number; checkRevision: number; checking: string[] };

/** 확인 결과(GET /api/admin/track-cache/checks?keys=<음원 키>,…). 확인 번호가 바뀌었을 때 화면의 줄만 다시 받는다 */
type TrackCacheChecks = { checks: Record<string, TrackCheck>; checkRevision: number };

export { TRACK_CACHE_TABLES, TRACK_CACHE_COLUMNS, TRACK_CACHE_DEFAULT_SORT, TRACK_CACHE_PAGE_MAX, TRACK_CACHE_FILTER_MAX, TRACK_CACHE_REGEX_MAX, TRACK_CACHE_OPS_MAX, TRACK_CACHE_FILE_DELETES_MAX, TRACK_CACHE_PROBE_MAX, isTrackCacheTable, isTrackCacheColumn, trackCacheSearch };
export type { TrackCacheTable, TrackCacheColumn, TrackFileStatus, TrackCheck, TrackRequestRow, TrackFileRow, TrackAgeRow, TrackCacheRow, TrackCacheSort, TrackCacheQuery, TrackCachePage, TrackCacheOp, TrackCacheOpName, TrackCacheWrite, TrackFileUse, TrackCacheOpResult, TrackCacheWritten, TrackCacheProbe, TrackCacheProbeQueued, TrackCacheRevision, TrackCacheChecks };
