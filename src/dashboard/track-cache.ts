// 캐시 DB(운영자 패널 "캐시 DB" 탭)의 읽기 · 쓰기 · 값 검사. 모양은 contract/track-cache.
// 화면의 표 셋은 cache.db 의 표를 메모리에서 이은 것이다(음원 키는 audioKeyOf 로 셈해야 해서 SQL 로 잇지 못한다). 읽기는 쓰는 함수를 부르지 않는다.
// 쓰기는 모두 검사한 뒤 DB 몫(동기라 그사이 봇이 끼어들지 않는다)을 먼저, 캐시 파일 삭제를 그 뒤에 하나씩. 조작마다 결과를 낸다.
// 계약이 대시보드 층에 있어 usecases 가 아니라 여기 둔다(백업의 settings-archive 와 같다).

import { TRACK_CACHE_COLUMNS, TRACK_CACHE_COLUMN_KINDS, TRACK_CACHE_FILE_DELETES_MAX, TRACK_CACHE_OPS_MAX, TRACK_CACHE_PAGE_MAX, isTrackCacheColumn, isTrackCacheTable, type TrackAgeRow, type TrackCacheInspect, type TrackCacheInspected, type TrackCacheOp, type TrackCacheOpName, type TrackCacheOpResult, type TrackCachePage, type TrackCacheQuery, type TrackCacheTable, type TrackCacheWritten, type TrackCheck, type TrackFileRow, type TrackRequestRow } from "./contract/track-cache.ts";
import type { FieldProblem } from "./contract/problem.ts";
import { matchFilter, matchWords, parseFilter, parseWords, type ColumnKind, type Filter } from "../rules/track-cache-filter.ts";
import { checkPinAudio, checkPinRequest } from "../rules/pin-source.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import { inputKind } from "../rules/input-kind.ts";
import { youtubeWatchUrl } from "../rules/links.ts";
import { isCode, type Code, type Params } from "../rules/problems.ts";
import { cacheRevision } from "../store/cache-db.ts";
import * as audioCache from "../store/audio-cache.ts";
import * as trackLookup from "../store/track-lookup.ts";
import * as pinnedSources from "../store/pinned-sources.ts";
import * as externalCaches from "../store/external-caches.ts";
import * as sourceChecks from "../store/source-checks.ts";
import type { LookupRow } from "../store/rows.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });

/** 거절. 경로가 문제로 답한다(errors 의 pointer 는 읽기면 /filters/<열> · /q · /sort, 쓰기면 /ops/<번호>/<필드>) */
type Refusal = { ok: false; code: Code; params?: Params; errors?: FieldProblem[] };

const refusal = (code: Code, errors?: FieldProblem[], params?: Params): Refusal => ({ ok: false, code, ...(params ? { params } : {}), ...(errors ? { errors } : {}) });
const firstOf = (errors: FieldProblem[]): Refusal => refusal(errors[0].code, errors, errors[0].max !== undefined ? { max: errors[0].max } : undefined);

// ── 행 잇기 ──────────────────────────────────────────────────────────────────

type Sources = { ledger: LookupRow[]; pins: pinnedSources.Pin[]; files: Map<string, audioCache.AudioRow>; age: Map<string, number>; checks: Map<string, sourceChecks.Check> };

function load(): Sources {
  return {
    ledger: trackLookup.allRows(),
    pins: pinnedSources.allPins(),
    files: new Map(audioCache.allRows().map((row) => [row.audio_key, row])),
    age: new Map(externalCaches.allAgeRestricted().map((one) => [one.videoId, one.markedAt])),
    checks: sourceChecks.allChecks(),
  };
}

// 남긴 실패 코드가 문제 목록에 없으면(이전 코드) 알 수 없는 오류로
const checkOf = (check: sourceChecks.Check | undefined): TrackCheck | null => (check ? (check.ok ? check : { ok: false, code: check.code === "live" || isCode(check.code) ? check.code : "unknown-error", at: check.at }) : null);

// 요청 행의 링크 데이터 몫 · 직접 지정한 음원 몫
function requestCells(requestKey: string, led: LookupRow | undefined, pin: pinnedSources.Pin | undefined) {
  if (!led) return { requestKey, platform: inputKind(requestKey), title: null, artist: null, audioUrl: pin!.audioUrl, ledgerAudioUrl: null, pinnedAt: pin!.pinnedAt };
  return { requestKey, platform: led.platform, title: led.display_title, artist: led.display_artist, audioUrl: pin?.audioUrl ?? led.audio_url, ledgerAudioUrl: led.audio_url, pinnedAt: pin?.pinnedAt ?? null };
}

// 쓰는 음원의 음원 키로 이어 붙인 몫. 이을 것이 없으면 빔
function audioCells(src: Sources, audioKey: string | null) {
  const file = audioKey ? src.files.get(audioKey) : undefined;
  const videoId = audioKey?.startsWith("yt:") ? audioKey.slice(3) : null;
  const cells = file ? { file: file.status, size: file.file_size_bytes, plays: file.play_count, lastPlayedAt: file.last_played_at, downloadedAt: file.downloaded_at } : { file: "none" as const, size: null, plays: null, lastPlayedAt: null, downloadedAt: null };
  return { ...cells, ageMarkedAt: videoId ? (src.age.get(videoId) ?? null) : null, check: audioKey ? checkOf(src.checks.get(audioKey)) : null };
}

function requestRows(src: Sources): TrackRequestRow[] {
  const ledger = new Map(src.ledger.map((row) => [row.request_key, row]));
  const pins = new Map(src.pins.map((pin) => [pin.requestKey, pin]));
  const rows = [...new Set([...ledger.keys(), ...pins.keys()])].map((requestKey): TrackRequestRow => {
    const cells = requestCells(requestKey, ledger.get(requestKey), pins.get(requestKey));
    const audioKey = audioKeyOf(cells.audioUrl);
    return { ...cells, sameAsRequest: audioKey !== null && audioKey === audioKeyOf(requestKey), audioKey, ...audioCells(src, audioKey), sharedBy: 1 };
  });
  const shared = new Map<string, number>();
  for (const row of rows) if (row.audioKey) shared.set(row.audioKey, (shared.get(row.audioKey) ?? 0) + 1);
  for (const row of rows) if (row.audioKey) row.sharedBy = shared.get(row.audioKey)!;
  return rows;
}

// 음원 키에서 주소. 유튜브 · 사운드클라우드는 다시 만들고(audioKeyOf 의 역), 직접 링크(md5)는 그 키를 가리키는 직접 지정한 음원 · 링크 데이터에서
function urlsOfKeys(src: Sources): (audioKey: string) => string | null {
  const direct = new Map<string, string>();
  for (const url of [...src.ledger.map((row) => row.audio_url), ...src.pins.map((pin) => pin.audioUrl)]) {
    const key = audioKeyOf(url);
    if (key?.startsWith("dl:") && !direct.has(key)) direct.set(key, url);
  }
  return (audioKey) => {
    if (audioKey.startsWith("yt:")) return youtubeWatchUrl(audioKey.slice(3));
    if (audioKey.startsWith("sc:")) {
      const path = audioKey.slice(3);
      return path.split("/")[0].includes(".") ? `https://${path}` : `https://soundcloud.com/${path}`;
    }
    return direct.get(audioKey) ?? null;
  };
}

function fileRows(src: Sources): TrackFileRow[] {
  const uses = new Map<string, number>();
  for (const row of requestRows(src)) if (row.audioKey) uses.set(row.audioKey, (uses.get(row.audioKey) ?? 0) + 1);
  const urlOf = urlsOfKeys(src);
  return [...src.files.values()].map((row) => ({
    audioKey: row.audio_key,
    audioUrl: urlOf(row.audio_key),
    title: row.title,
    channel: row.channel,
    status: row.status,
    size: row.file_size_bytes,
    duration: row.duration_sec,
    plays: row.play_count,
    lastPlayedAt: row.last_played_at,
    downloadedAt: row.downloaded_at,
    requests: uses.get(row.audio_key) ?? 0,
  }));
}

const ageRows = (src: Sources): TrackAgeRow[] => [...src.age].map(([videoId, markedAt]) => ({ videoId, markedAt }));

type AnyRow = TrackRequestRow | TrackFileRow | TrackAgeRow;
// 셀의 원시 값(필터 · 정렬은 이것으로). 재생 테스트는 결과 문자열, 정렬은 테스트한 때
function rawOf(row: AnyRow, column: string): string | number | null {
  if (column === "check") {
    const check = (row as TrackRequestRow).check;
    return check ? (check.ok ? "ok" : check.code) : null;
  }
  const value = (row as Record<string, unknown>)[column];
  return typeof value === "string" || typeof value === "number" ? value : null;
}
const sortValueOf = (row: AnyRow, column: string) => (column === "check" ? ((row as TrackRequestRow).check?.at ?? null) : rawOf(row, column));
const KEY_OF: Record<TrackCacheTable, string> = { requests: "requestKey", files: "audioKey", age: "videoId" };

// ── 읽기 ────────────────────────────────────────────────────────────────────

/** 필터링 한 번의 시간 상한. 음악 재생과 같은 이벤트 루프라 길게 막지 않는다(겹친 반복 거절을 빠져나간 정규식) */
const FILTER_TIME_MS = 100;
// 시각을 이 행 수마다 본다
const FILTER_CHECK_EVERY = 256;

const COLLATOR = new Intl.Collator("ko");
// 빈 값은 방향과 상관없이 뒤로
function compare(a: string | number | null, b: string | number | null, dir: "asc" | "desc") {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order = typeof a === "number" && typeof b === "number" ? a - b : COLLATOR.compare(String(a), String(b));
  return dir === "desc" ? -order : order;
}

/**
 * 주소 질의를 읽기로(contract 의 trackCacheSearch 의 역). 모르는 열 · 같은 키가 여럿 · 정렬 열이 겹치면 거절한다.
 * 필터 식은 여기서 읽지 않는다(read 가 읽는다)
 */
// 값 하나만 받는 키(없으면 fallback). 여럿이면 null
function single(search: URLSearchParams, name: string, fallback: string) {
  const all = search.getAll(name);
  return all.length > 1 ? null : (all[0] ?? fallback);
}
const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

function filtersOf(table: TrackCacheTable, search: URLSearchParams, errors: FieldProblem[]) {
  const filters: Record<string, string> = {};
  for (const [name, expr] of search) {
    if (!name.startsWith("f.")) continue;
    const column = name.slice(2);
    if (!isTrackCacheColumn(table, column) || column in filters) errors.push({ pointer: `/filters/${column}`, code: "bad-request" });
    else filters[column] = expr;
  }
  return filters;
}

// raw: 정렬 값(없으면 빈 문자열, 여럿이면 null)
function sortOf(table: TrackCacheTable, raw: string | null, errors: FieldProblem[]) {
  const sort: Array<{ column: string; dir: "asc" | "desc" }> = [];
  for (const part of raw === "" ? [] : (raw ?? "").split(",")) {
    const [column, dir] = part.split(":");
    if (!isTrackCacheColumn(table, column) || (dir !== "asc" && dir !== "desc") || sort.some((one) => one.column === column)) {
      errors.push({ pointer: "/sort", code: "bad-request" });
      break;
    }
    sort.push({ column, dir });
  }
  return sort;
}

function queryOf(search: URLSearchParams): { ok: true; query: TrackCacheQuery } | Refusal {
  const table = single(search, "table", "");
  if (!isTrackCacheTable(table)) return refusal("bad-request");
  const [offset, limit] = [Number(single(search, "offset", "0")), Number(single(search, "limit", "50"))];
  if (!inRange(offset, 0, Number.MAX_SAFE_INTEGER) || !inRange(limit, 1, TRACK_CACHE_PAGE_MAX)) return refusal("bad-page-range");
  const errors: FieldProblem[] = [];
  const filters = filtersOf(table, search, errors);
  const q = single(search, "q", "");
  if (q === null) errors.push({ pointer: "/q", code: "bad-request" });
  const sort = sortOf(table, single(search, "sort", ""), errors);
  if (errors.length) return firstOf(errors);
  return { ok: true, query: { table, filters, q, sort, offset, limit } as TrackCacheQuery };
}

const problemOf = (pointer: string, problem: { code: Code; max?: number }): FieldProblem => ({ pointer, code: problem.code, ...(problem.max ? { max: problem.max } : {}) });

// 열마다의 식과 아무 열에서나의 낱말을 읽어 행 하나를 보는 함수로
function matcherOf(query: TrackCacheQuery): { ok: true; matches: (row: AnyRow) => boolean } | Refusal {
  const kinds = TRACK_CACHE_COLUMN_KINDS[query.table] as Record<string, ColumnKind>;
  const errors: FieldProblem[] = [];
  const filters: Array<{ column: string; filter: Filter }> = [];
  for (const [column, expr] of Object.entries(query.filters) as Array<[string, string | undefined]>) {
    const parsed = parseFilter(kinds[column], expr ?? "");
    if (parsed?.ok) filters.push({ column, filter: parsed.filter });
    else if (parsed) errors.push(problemOf(`/filters/${column}`, parsed));
  }
  const words = parseWords(query.q);
  if (words && !words.ok) errors.push(problemOf("/q", words));
  if (errors.length) return firstOf(errors);
  const columns = TRACK_CACHE_COLUMNS[query.table] as readonly string[];
  const anyColumn = words?.ok ? words.words : null;
  const inColumns = (row: AnyRow) => filters.every(({ column, filter }) => matchFilter(filter, rawOf(row, column)));
  const inAny = (row: AnyRow) =>
    !anyColumn ||
    matchWords(
      anyColumn,
      columns.map((column) => rawOf(row, column)),
    );
  return { ok: true, matches: (row) => inColumns(row) && inAny(row) };
}

/** 표 하나의 구간. 필터 · 정렬은 메모리에서(SQL 을 만들지 않는다) */
function read(query: TrackCacheQuery): { ok: true; page: TrackCachePage } | Refusal {
  const { table, offset, limit } = query;
  const matcher = matcherOf(query);
  if (!matcher.ok) return matcher;
  const src = load();
  const all: AnyRow[] = table === "requests" ? requestRows(src) : table === "files" ? fileRows(src) : ageRows(src);
  const started = performance.now();
  const matched: AnyRow[] = [];
  for (const [i, row] of all.entries()) {
    if (i % FILTER_CHECK_EVERY === FILTER_CHECK_EVERY - 1 && performance.now() - started > FILTER_TIME_MS) return refusal("filter-timeout");
    if (matcher.matches(row)) matched.push(row);
  }
  const key = KEY_OF[table];
  matched.sort((a, b) => {
    for (const { column, dir } of query.sort) {
      const order = compare(sortValueOf(a, column), sortValueOf(b, column), dir);
      if (order) return order;
    }
    return compare(rawOf(a, key), rawOf(b, key), "asc");
  });
  const { revision, checkRevision } = cacheRevision();
  return { ok: true, page: { table, rows: matched.slice(offset, offset + limit), offset, total: all.length, matched: matched.length, revision, checkRevision } as TrackCachePage };
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────

// 모두 검사(하나라도 걸리면 아무것도 쓰지 않는다). 새 행의 요청 키는 다듬은 것으로 바꿔 둔다
function validate(ops: TrackCacheOp[]): { ok: true; ops: TrackCacheOp[] } | Refusal {
  if (!ops.length) return refusal("nothing-to-save");
  if (ops.length > TRACK_CACHE_OPS_MAX) return refusal("too-many-items", undefined, { max: TRACK_CACHE_OPS_MAX });
  if (ops.filter((op) => op.op === "deleteFile").length > TRACK_CACHE_FILE_DELETES_MAX) return refusal("too-many-file-deletes", undefined, { max: TRACK_CACHE_FILE_DELETES_MAX });
  const exists = (requestKey: string) => trackLookup.getAudioUrl(requestKey) !== null || pinnedSources.getPin(requestKey) !== null;
  const errors: FieldProblem[] = [];
  const checked = ops.map((op, i): TrackCacheOp => {
    if (op.op === "pin") {
      const audio = checkPinAudio(op.audioUrl);
      if (!audio.ok) errors.push({ pointer: `/ops/${i}/audioUrl`, code: audio.code });
      let requestKey = op.requestKey;
      if (!exists(requestKey)) {
        const request = checkPinRequest(requestKey);
        if (request.ok) requestKey = request.canonical;
        else errors.push({ pointer: `/ops/${i}/requestKey`, code: request.code });
      }
      return audio.ok ? { ...op, requestKey, audioUrl: audio.canonical } : op;
    }
    if (op.op === "clearResult") {
      const ledger = trackLookup.getAudioUrl(op.requestKey);
      const key = audioKeyOf(ledger);
      if (ledger !== null && key !== null && key === audioKeyOf(op.requestKey)) errors.push({ pointer: `/ops/${i}`, code: "nothing-to-clear" });
    }
    return op;
  });
  return errors.length ? firstOf(errors) : { ok: true, ops: checked };
}

// DB 몫 하나(동기). expect 는 각 저장소 함수가 WHERE 에 넣는다
function applyDbOp(op: Exclude<TrackCacheOp, { op: "deleteFile" }>): TrackCacheOpResult {
  if (op.op === "pin") return pinnedSources.repin(op.requestKey, op.audioUrl, op.expect);
  if (op.op === "unpin") return pinnedSources.unpin(op.requestKey, op.expect);
  if (op.op === "clearResult") return trackLookup.clearResult(op.requestKey, op.expect);
  if (op.op === "deleteRequest") return pinnedSources.deleteRequest(op.requestKey, op.expect);
  return externalCaches.clearAgeRestricted(op.videoId, op.expect);
}

// 캐시 파일 삭제 하나(정리 잠금 안). 지운 바이트는 화면에 보내지 않는다
async function applyFileOp(op: Extract<TrackCacheOp, { op: "deleteFile" }>): Promise<TrackCacheOpResult> {
  const removed = await audioCache.removeCached(op.audioKey, op.expect);
  return removed.ok ? { ok: true } : removed;
}

// 로그의 조작 이름
const OP_NAMES: Record<TrackCacheOpName, string> = { pin: "직접 지정", unpin: "지정 해제", clearResult: "자동 검색 결과 삭제", deleteRequest: "요청 삭제", deleteFile: "캐시 파일 삭제", clearAge: "연령 제한 표시 삭제" };
const targetOf = (op: TrackCacheOp) => (op.op === "deleteFile" ? op.audioKey : op.op === "clearAge" ? op.videoId : op.requestKey);

/**
 * 조작 목록을 쓴다. 모두 검사해 하나라도 걸리면 아무것도 쓰지 않고 거절한다. 결과는 조작 순서 그대로(모두 되거나 모두 안 됨으로 묶지 않는다).
 * @param by  로그에 남길 실행한 사람
 */
async function write(input: TrackCacheOp[], by: string): Promise<{ ok: true; written: TrackCacheWritten } | Refusal> {
  const valid = validate(input);
  if (!valid.ok) return valid;
  const { ops } = valid;
  const results: TrackCacheOpResult[] = new Array(ops.length);
  for (const [i, op] of ops.entries()) if (op.op !== "deleteFile") results[i] = applyDbOp(op);
  for (const [i, op] of ops.entries()) if (op.op === "deleteFile") results[i] = await applyFileOp(op);

  const counts = new Map<TrackCacheOpName, { done: number; failed: number }>();
  for (const [i, op] of ops.entries()) {
    const count = counts.get(op.op) ?? { done: 0, failed: 0 };
    count[results[i].ok ? "done" : "failed"]++;
    counts.set(op.op, count);
    log.debug({ sub: "track-cache" }, `캐시 DB ${OP_NAMES[op.op]}: ${targetOf(op)} | ${results[i].ok ? "됨" : JSON.stringify(results[i])}`);
  }
  const summary = [...counts].map(([name, { done, failed }]) => `${OP_NAMES[name]} ${done + failed}${failed ? `(실패 ${failed})` : ""}`).join(" · ");
  log.warn({ sub: "admin" }, `대시보드에서 캐시 DB 저장: ${summary}. 실행 ${by}`);
  return { ok: true, written: { results, revision: cacheRevision().revision } };
}

/** 값 검사 미리 보기(셀 편집 창의 정보 줄). 주소만 본다 */
function inspect(body: TrackCacheInspect): TrackCacheInspected {
  const out: TrackCacheInspected = {};
  if (typeof body.requestKey === "string") {
    const request = checkPinRequest(body.requestKey);
    out.request = request.ok ? { ok: true, canonical: request.canonical, platform: request.platform } : request;
  }
  if (typeof body.audioUrl === "string") {
    const audio = checkPinAudio(body.audioUrl);
    out.audio = audio.ok ? { ok: true, canonical: audio.canonical, kind: audio.kind, audioKey: audio.audioKey } : audio;
  }
  return out;
}

export { queryOf, read, write, inspect };
export type { Refusal };
