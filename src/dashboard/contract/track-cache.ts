// 캐시 DB(운영자 패널 "캐시 DB" 탭)의 모양. /api/admin/track-cache. 봇과 화면이 같이 읽으므로 Node 를 부르지 않는다.
// 겉은 DB Browser for SQLite 의 데이터 보기를 본뜨지만 원본 표가 아니다: 표 셋(요청 · 캐시 파일 · 연령 제한)은 이 화면의 표이고(cache.db 의 표를 봇이 이어 붙인다),
// 셀 편집은 정해진 조작(TrackCacheOp)으로 바꿔 보낸다. 서버는 열 이름을 받지 않는다.
// 읽기는 표 하나의 구간(필터 · 정렬은 서버가), 쓰기는 조작 목록을 한 번에(모두 검사한 뒤 조작마다 결과), 재생 확인은 바로 하는 일이라 따로 큐에 넣는다.

import type { Code } from "../../rules/problems.ts";
import { FILTER_MAX, REGEX_MAX, type ColumnKind } from "../../rules/track-cache-filter.ts";

const TRACK_CACHE_TABLES = ["requests", "files", "age"] as const;
type TrackCacheTable = (typeof TRACK_CACHE_TABLES)[number];
const isTrackCacheTable = (value: unknown): value is TrackCacheTable => TRACK_CACHE_TABLES.includes(value as TrackCacheTable);

/**
 * 표마다의 열(화면의 처음 순서). 필터 · 정렬은 이 이름으로만 받고 원시 값으로 한다(크기는 바이트, 때는 ms).
 * 합친 열의 원시 값: pinnedAt · ageMarkedAt 은 그 때(없으면 빔), file · status 는 상태 문자열(cached · downloading · error · none),
 * check 는 확인 결과 문자열(ok 또는 실패 코드, 확인하지 않았으면 빔. 정렬은 확인한 때)
 */
const TRACK_CACHE_COLUMNS = {
  requests: ["requestKey", "platform", "title", "artist", "audioUrl", "pinnedAt", "file", "size", "plays", "lastPlayedAt", "ageMarkedAt", "check"],
  files: ["audioKey", "audioUrl", "title", "channel", "status", "size", "duration", "plays", "lastPlayedAt", "downloadedAt", "requests"],
  age: ["videoId", "markedAt"],
} as const satisfies Record<TrackCacheTable, readonly string[]>;
type TrackCacheColumn<T extends TrackCacheTable = TrackCacheTable> = (typeof TRACK_CACHE_COLUMNS)[T][number];
/** 열의 형식(필터 식의 값을 이 형식으로 읽는다) */
const TRACK_CACHE_COLUMN_KINDS: { readonly [T in TrackCacheTable]: Record<TrackCacheColumn<T>, ColumnKind> } = {
  requests: { requestKey: "text", platform: "text", title: "text", artist: "text", audioUrl: "text", pinnedAt: "time", file: "text", size: "bytes", plays: "count", lastPlayedAt: "time", ageMarkedAt: "time", check: "text" },
  files: { audioKey: "text", audioUrl: "text", title: "text", channel: "text", status: "text", size: "bytes", duration: "seconds", plays: "count", lastPlayedAt: "time", downloadedAt: "time", requests: "count" },
  age: { videoId: "text", markedAt: "time" },
};
const isTrackCacheColumn = <T extends TrackCacheTable>(table: T, value: unknown): value is TrackCacheColumn<T> => (TRACK_CACHE_COLUMNS[table] as readonly unknown[]).includes(value);

/** 한 번에 읽는 행 수 · 확인 결과를 한 번에 묻는 음원 키 수 상한 */
const TRACK_CACHE_PAGE_MAX = 200;
/** 열 하나의 필터 식 · 아무 열에서나 필터 · 그 안의 정규식 길이 상한(식을 읽는 rules/track-cache-filter 의 것) */
const TRACK_CACHE_FILTER_MAX = FILTER_MAX;
const TRACK_CACHE_REGEX_MAX = REGEX_MAX;
/** 한 번에 쓰는 조작 · 그중 파일 삭제 상한 */
const TRACK_CACHE_OPS_MAX = 200;
const TRACK_CACHE_FILE_DELETES_MAX = 100;
/** 재생 확인을 한 번에 큐에 넣는 수 상한 */
const TRACK_CACHE_PROBE_MAX = 20;

// ── 행 ──────────────────────────────────────────────────────────────────────

/** 캐시 파일의 상태. none: 행이 없다(밀려났거나 다운로드한 적 없음, 음원 키를 계산할 수 없는 주소 포함) */
type TrackFileStatus = "cached" | "downloading" | "error" | "none";

/** 재생 확인 결과. 운영자가 누른 확인과 직접 지정한 음원이 틀다 죽은 것이 같은 위치에 남는다. code 는 실패한 까닭(라이브면 "live") */
type TrackCheck = { ok: true; at: number } | { ok: false; code: Code | "live"; at: number };

/**
 * 요청 표의 한 행: 요청 하나(링크 데이터 행 ∪ 직접 지정한 음원. 직접 지정한 음원은 링크 데이터에 없어도 행이 있다).
 * 캐시 파일 · 크기 · 재생 수 · 마지막 재생 · 연령 제한 · 확인은 쓰는 음원(audioUrl)의 음원 키로 이어 붙인 것이라, 이을 것이 없으면 null(화면은 "—")
 */
type TrackRequestRow = {
  /** 원래 링크(링크 데이터의 키, canonicalUrl) 또는 자동재생 키(amq: · at: 등) */
  requestKey: string;
  /** 링크 데이터의 출처. 직접 지정한 음원만 있는 행은 원래 링크의 종류(inputKind)에서 */
  platform: string;
  title: string | null;
  artist: string | null;
  /** 쓰는 음원: 지정했으면 지정한 것, 아니면 링크 데이터의 자동 검색 결과 */
  audioUrl: string;
  /** 링크 데이터의 자동 검색 결과(지정했어도 둔다: 풀면 돌아갈 곳). 링크 데이터 행이 없으면 null */
  ledgerAudioUrl: string | null;
  /** 지정한 때. 지정하지 않았으면 null(지정했으면 audioUrl 이 직접 지정한 음원이다) */
  pinnedAt: number | null;
  /** 쓰는 음원이 원래 링크 그대로다(음원 키가 같다). 지정하지 않은 행이면 자동 검색 결과가 없어 삭제가 막힌다 */
  sameAsRequest: boolean;
  /** 쓰는 음원의 음원 키(yt: · sc: · dl:). 키를 계산할 수 없는 주소면 null */
  audioKey: string | null;
  file: TrackFileStatus;
  size: number | null;
  plays: number | null;
  lastPlayedAt: number | null;
  /** 다운로드한 때(캐시 파일 삭제의 expect) */
  downloadedAt: number | null;
  /** 연령 제한으로 표시한 때(표시 지우기의 expect). 표시가 없거나 유튜브 음원이 아니면 null */
  ageMarkedAt: number | null;
  check: TrackCheck | null;
  /** 같은 캐시 파일을 쓰는 요청 수(나 포함). 캐시 파일을 삭제하면 이만큼이 함께 바뀐다 */
  sharedBy: number;
};

/** 캐시 파일 표의 한 행: audio_cache 의 행. 요청이 가리키지 않는 파일도 있다(requests 0) */
type TrackFileRow = {
  audioKey: string;
  /**
   * 음원 주소. 유튜브는 영상 id 로, 사운드클라우드는 키(첫 부분에 점이 있으면 호스트부터, 없으면 soundcloud.com 의 경로)로 다시 만든다.
   * 직접 링크(dl:)는 md5 라 되돌릴 수 없어 그 키를 가리키는 링크 데이터 행 · 직접 지정한 음원에서 온다(없으면 null)
   */
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

/** 연령 제한 표의 한 행 */
type TrackAgeRow = { videoId: string; markedAt: number };

type TrackCacheRow<T extends TrackCacheTable = TrackCacheTable> = { requests: TrackRequestRow; files: TrackFileRow; age: TrackAgeRow }[T];

// ── 읽기(GET /api/admin/track-cache) ───────────────────────────────────────

type TrackCacheSort<T extends TrackCacheTable = TrackCacheTable> = ReadonlyArray<{ column: TrackCacheColumn<T>; dir: "asc" | "desc" }>;

/** 처음 정렬(화면이 처음에 보내고 헤더에 표시한다). sort 를 보내지 않으면 키 순서만(정렬 지우기) */
const TRACK_CACHE_DEFAULT_SORT: { readonly [T in TrackCacheTable]: TrackCacheSort<T> } = {
  requests: [{ column: "lastPlayedAt", dir: "desc" }],
  files: [{ column: "lastPlayedAt", dir: "desc" }],
  age: [{ column: "markedAt", dir: "desc" }],
};

/**
 * 읽기. filters 는 열마다 DB Browser for SQLite 의 필터 식 그대로(그냥 쓰면 포함 · = · <> · > < >= <= · a~b · /정규식/ · ='' · <>'',
 * 크기는 10MB 같은 단위 · 때는 2026-10-17 같은 날짜도), q 는 아무 열에서나(단어마다 어느 열에든 들어간 행). 열끼리는 AND.
 * 정렬은 선택한 열 다음에 그 표의 키를 끝 기준으로 붙여 같은 값의 행이 흔들리지 않는다
 */
type TrackCacheQuery<T extends TrackCacheTable = TrackCacheTable> = {
  [K in T]: { table: K; filters: Partial<Record<TrackCacheColumn<K>, string>>; q: string; sort: TrackCacheSort<K>; offset: number; limit: number };
}[T];

/**
 * 읽은 구간. total: 그 표의 전부 · matched: 필터에 맞는 것. revision 은 이 표들에 쓰면 오르는 리비전 번호(다르면 화면이 "새 변경 사항이 있어요" 알약),
 * checkRevision 은 재생 확인 결과의 번호(운영자가 누른 확인은 알약을 표시하지 않게 따로)
 */
type TrackCachePage<T extends TrackCacheTable = TrackCacheTable> = {
  [K in T]: { table: K; rows: Array<TrackCacheRow<K>>; offset: number; total: number; matched: number; revision: number; checkRevision: number };
}[T];

/**
 * 읽기를 주소 질의로: f.<열>=식 · q · sort=<열>:asc,<열>:desc · offset · limit. 빈 필터 · 빈 q 는 보내지 않는다.
 * 서버는 모르는 열 · 같은 키가 여럿 · 정렬 열이 겹치는 것을 거절한다(문제의 pointer 는 /filters/<열> · /q · /sort)
 */
function trackCacheSearch(query: TrackCacheQuery): URLSearchParams {
  const search = new URLSearchParams({ table: query.table, offset: String(query.offset), limit: String(query.limit) });
  if (query.q) search.set("q", query.q);
  for (const [column, expr] of Object.entries(query.filters) as Array<[string, string | undefined]>) if (expr) search.set(`f.${column}`, expr);
  if (query.sort.length) search.set("sort", query.sort.map((one) => `${one.column}:${one.dir}`).join(","));
  return search;
}

// ── 쓰기(POST /api/admin/track-cache) ──────────────────────────────────────

/**
 * 조작 하나. expect 는 화면이 본 값(그사이 봇이 바꿨으면 그 조작은 "changed" 로 막힌다). 봇이 늘 다시 쓰는 열(재생 수 · 마지막 재생)은 비교하지 않는다.
 * pin: 직접 지정한 음원으로(새 행도 이것) · unpin: 직접 지정한 음원 풀기 · clearResult: 링크 데이터의 자동 검색 결과 삭제(다음에 다시 찾는다) ·
 * deleteRequest: 링크 데이터 행과 직접 지정한 음원 삭제 · deleteFile: 캐시 파일 삭제(파일 없는 error 행은 행만) · clearAge: 연령 제한 표시 지우기
 */
type TrackCacheOp = { op: "pin"; requestKey: string; audioUrl: string; expect: string | null } | { op: "unpin"; requestKey: string; expect: string } | { op: "clearResult"; requestKey: string; expect: string } | { op: "deleteRequest"; requestKey: string; expect: { ledgerAudioUrl: string | null; pinned: string | null } } | { op: "deleteFile"; audioKey: string; expect: number | null } | { op: "clearAge"; videoId: string; expect: number };
type TrackCacheOpName = TrackCacheOp["op"];

/** 쓰기. 먼저 모두 검사한다: 하나라도 걸리면 아무것도 쓰지 않고 문제로 답한다(errors 의 pointer 가 /ops/<번호>/<필드>) */
type TrackCacheWrite = { ops: TrackCacheOp[] };

/** 파일을 쓰는 곳: 재생 중 · 대기열 앞(미리 다운로드 몫) · 저장 세션 앞 · 내보내는 중 */
type TrackFileUse = "playing" | "queued" | "saved-session" | "exporting";

/** 바뀐 지금 값(조작의 expect 와 같은 형식) */
type TrackCacheCurrent = string | number | null | { ledgerAudioUrl: string | null; pinned: string | null };

/**
 * 조작 하나의 결과. 모두 되거나 모두 안 됨으로 묶지 않는다(조작끼리 서로 기대지 않고, 삭제한 파일은 되돌릴 수 없다).
 * changed: 화면이 본 값과 지금 값이 다르다 · gone: 가리킨 행이 없다 · in-use: 쓰는 중이라 삭제하지 않았다 · downloading: 다운로드 중이다 ·
 * failed: 파일을 삭제하지 못했다(Windows 잠금 · 시간 초과 · 그 밖. 행은 남는다)
 */
type TrackCacheOpResult = { ok: true } | { ok: false; code: "changed"; current: TrackCacheCurrent } | { ok: false; code: "gone" } | { ok: false; code: "in-use"; where: TrackFileUse } | { ok: false; code: "downloading" } | { ok: false; code: "failed" };

/** 쓰기의 답. results 는 조작 순서 그대로. 화면은 실패한 것을 바뀐 채 두고 다시 읽는다 */
type TrackCacheWritten = { results: TrackCacheOpResult[]; revision: number };

/**
 * 값 검사 미리 보기(POST /api/admin/track-cache/inspect). 셀 편집 창의 정보 줄: 어떤 주소인지 · 음원 키 · 막힌 까닭.
 * 음원 키 계산(audioKeyOf)이 Node 를 불러 화면이 직접 하지 못한다. 주소만 보고 통신하지 않는다(재생되는지는 재생 확인)
 */
type TrackCacheInspect = { requestKey?: string; audioUrl?: string };
/** ok 면 저장될 형식(canonicalUrl) · 종류 · 음원 키, 아니면 막힌 까닭의 문제 코드 */
type TrackCacheInspected = {
  request?: { ok: true; canonical: string; platform: string } | { ok: false; code: Code };
  audio?: { ok: true; canonical: string; kind: string; audioKey: string } | { ok: false; code: Code };
};

// ── 재생 확인 ───────────────────────────────────────────────────────────────

/** 재생 확인 큐에 넣기(POST /api/admin/track-cache/probe). 쓰기 전 값이 있으면 그 주소로. 곧바로 돌아오고 봇이 하나씩 순서대로 한다 */
type TrackCacheProbe = { audioUrls: string[] };
/** 넣은 것: queued 새로 넣음 · already 이미 큐에 있음 · keys 는 주소마다의 음원 키(쓰기 전 주소도 checking · checks 와 맞춰 보게) */
type TrackCacheProbeQueued = { queued: number; already: number; keys: string[] };

/** 리비전 번호(GET /api/admin/track-cache/revision). 탭이 보이는 동안 운영자 패널의 3초 읽기가 이것만 본다. checking: 확인을 기다리거나 하는 중인 음원 키 */
type TrackCacheRevision = { revision: number; checkRevision: number; checking: string[] };

/** 확인 결과(GET /api/admin/track-cache/checks?keys=<음원 키>,…, 한 번에 TRACK_CACHE_PAGE_MAX 개까지). 확인 번호가 바뀌었을 때 화면의 행만 다시 받는다 */
type TrackCacheChecks = { checks: Record<string, TrackCheck>; checkRevision: number };

export { TRACK_CACHE_TABLES, TRACK_CACHE_COLUMNS, TRACK_CACHE_COLUMN_KINDS, TRACK_CACHE_DEFAULT_SORT, TRACK_CACHE_PAGE_MAX, TRACK_CACHE_FILTER_MAX, TRACK_CACHE_REGEX_MAX, TRACK_CACHE_OPS_MAX, TRACK_CACHE_FILE_DELETES_MAX, TRACK_CACHE_PROBE_MAX, isTrackCacheTable, isTrackCacheColumn, trackCacheSearch };
export type { TrackCacheTable, TrackCacheColumn, TrackFileStatus, TrackCheck, TrackRequestRow, TrackFileRow, TrackAgeRow, TrackCacheRow, TrackCacheSort, TrackCacheQuery, TrackCachePage, TrackCacheOp, TrackCacheOpName, TrackCacheWrite, TrackFileUse, TrackCacheCurrent, TrackCacheOpResult, TrackCacheWritten, TrackCacheInspect, TrackCacheInspected, TrackCacheProbe, TrackCacheProbeQueued, TrackCacheRevision, TrackCacheChecks };
