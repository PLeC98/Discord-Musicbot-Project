// SponsorBlock. 영상별 비음악/인트로/아웃트로 등 구간을 SponsorBlock API로 조회해 자동 스킵에 쓴다.
//
// 설계:
//  - 해시 프리픽스 엔드포인트로 조회한다(어떤 영상을 트는지 서버에 드러내지 않는다).
//  - 원시 세그먼트(카테고리 전부)를 write-through 캐시에 저장하고, 정규화 · 필터는 읽을 때 카테고리별로 한다.
//  - fail-open: 받아 둔 답이 있으면 바로 쓰고, 오래됐거나(받은 때) 다른 주소에서 받았으면 뒤에서 다시 받는다. 없으면 라이브를 기다리고, 실패 · 타임아웃이면 스킵 없이 진행한다.
//  - config.sponsorblock.enabled=false 면 API · 캐시 모두 동작하지 않는다(상업적 이용을 위한 전체 차단 스위치).
//
// 세그먼트 데이터: https://sponsor.ajay.app (CC BY-NC-SA 4.0).

import crypto from "crypto";
import * as links from "../rules/links.ts";
import config from "../config/index.ts";
import * as GuildSettingsManager from "../store/guild-settings.ts";
import * as externalCaches from "../store/external-caches.ts";
import { SKIP_CATEGORIES } from "../rules/sponsor-categories.ts";
import { httpFor, type Judged } from "../infra/http.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "sponsor" });

// 바깥으로 나가는 요청은 공유 HTTP 클라이언트로(부른 결과가 남는다). 테스트는 useFetch 로 가짜를 넘긴다(null 이면 실제 fetch)
const http = httpFor("sponsorblock");
const useFetch = http.useFetch;

// 주소가 SponsorBlock 구간 API가 아니면 처음 한 번 경고하고, 다시 답을 받으면 한 줄
const wrongAnswer = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "SponsorBlock 구간 조회");

/** 원시 구간 하나(카테고리 전부). 캐시에도 이 모양으로 담는다 */
type RawSegment = { category: string; actionType: string; start?: number; end?: number; votes?: number; locked?: number };
/** 병합한 스킵 구간 */
type SkipSegment = { start: number; end: number; categories: string[] };
type Source = "live" | "cache" | "none";
/** 곡에 걸 구간 · 하이라이트 */
type Segments = { skipSegments: SkipSegment[]; highlightAt: number | null; source: Source };
// API 응답(해시 앞자리에 걸린 영상들). 여기서 읽는 필드만
type ApiVideo = { videoID: string; segments?: Array<{ category: string; actionType: string; segment?: unknown; votes?: number; locked?: unknown }> };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// 조회는 늘 전 카테고리 + 하이라이트를 받아 캐시가 모든 카테고리를 갖게 한다(서버별 필터는 읽을 때)
const FETCH_CATEGORIES = [...SKIP_CATEGORIES, "poi_highlight"];
const FETCH_ACTION_TYPES = ["skip", "poi"];

/** 받은 답: 원시 구간(카테고리 전부)과 받은 때 · 주소. 주소를 모르면 null */
type Got = { raw: RawSegment[]; fetchedAt: number; apiBase: string | null };
/**
 * 영상 하나의 기억. loading: 처음 받는 중(DB에 없어 라이브를 기다린다). got: 쓰는 답(없으면 못 받았다).
 * missedAt: 마지막으로 못 받은 때. refreshing: 뒤에서 다시 받는 중
 */
type Entry = { loading: Promise<void> | null; got: Got | null; source: Source; missedAt: number; refreshing: boolean };

// 영상 id로 기억한 답(DB 캐시 앞의 메모리 기억). 서버마다 카테고리가 달라 필터링 전의 원시 구간을 기억한다
const remembered = new Map<string, Entry>();
const REMEMBER_MAX = 500;
const RETRY_NONE_MS = 10 * 60_000; // 답이 없는 영상은 이만큼 지나 다시 조회한다
const RETRY_STALE_MS = 30 * 60_000; // 오래된 답을 다시 받다 실패하면 이만큼 쉰다(답은 그대로 쓴다)
// forget() 마다 오른다. 그 전에 나간 조회의 답은 기억 · 저장하지 않고 버린다
let generation = 0;

// 겹치거나 맞닿은 skip 구간을 합친다. 합친 구간의 카테고리는 모두 남긴다
function mergeIntervals(segs: Array<{ start: number; end: number; category: string }>): SkipSegment[] {
  if (!segs.length) return [];
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out: SkipSegment[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      if (!last.categories.includes(s.category)) last.categories.push(s.category);
    } else {
      out.push({ start: s.start, end: s.end, categories: [s.category] });
    }
  }
  return out;
}

// 원시 세그먼트 배열 → { skipSegments, highlightAt }
//  - skipSegments: enabledCategories에 속한 skip 구간을 병합한 것
//  - highlightAt: poi_highlight 지점(최다 득표, 초) 또는 null
function normalize(raw: RawSegment[] | null | undefined, enabledCategories: Iterable<string>) {
  const enabled = new Set(enabledCategories);
  const skips = (raw || []).flatMap((s) => (s.actionType === "skip" && enabled.has(s.category) && finite(s.start) && finite(s.end) && s.end > s.start ? [{ start: s.start, end: s.end, category: s.category }] : []));
  const skipSegments = mergeIntervals(skips);

  const pois = (raw || []).filter((s): s is RawSegment & { start: number } => s.actionType === "poi" && s.category === "poi_highlight" && finite(s.start));
  const highlightAt = pois.length ? pois.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0].start : null;

  return { skipSegments, highlightAt };
}

/** 구간 API 응답을 구분한 것. videos: 그 접두어에 걸린 영상들(없으면 빈 배열). failed: 답이 아닌 까닭, notApi면 구간 API의 응답이 아니다 */
type Answer = { videos: ApiVideo[] } | { failed: string; notApi: boolean };

const isVideo = (v: unknown): v is ApiVideo => typeof v === "object" && v !== null && typeof (v as ApiVideo).videoID === "string";

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * 구간 API 응답을 읽어 구분한다. 200 + 영상 배열이 답이고, 404 + JSON 빈 배열은 "구간 없음"이라는 답이다(그 접두어에 구간이 하나도 없다).
 * 그 밖의 404(경로가 없는 서버의 HTML 등) · 배열이 아닌 200 · 읽을 수 없는 본문은 구간 API의 응답이 아니다(주소 · 접두어 길이가 맞지 않는 미러).
 * 그 밖의 상태(400 · 429 · 5xx)는 실패
 */
async function judgeSegments(res: Response): Promise<Judged<Answer>> {
  const status = `HTTP ${res.status}`;
  if (res.status !== 200 && res.status !== 404) return { value: { failed: status, notApi: false }, error: status };
  const body = parsed(await res.text());
  const json = res.headers.get("content-type")?.includes("application/json") ?? false;
  if (res.status === 200 && Array.isArray(body) && body.every(isVideo)) return { value: { videos: body }, error: null };
  if (res.status === 404 && json && Array.isArray(body) && body.length === 0) return { value: { videos: [] }, error: null };
  return { value: { failed: status, notApi: true }, error: "구간 API 응답이 아님" };
}

/**
 * videoId를 라이브로 조회해 원시 세그먼트 배열을 돌려준다(이 영상의 것이 없으면 빈 배열: 실패가 아니라 "구간 없음").
 * 답을 받지 못하면 null: 연결 오류 · 시간 초과 · 실패 상태 · 구간 API가 아닌 응답(운영자 설정 문제라 경고를 남긴다)
 */
async function _fetchRaw(videoId: string, apiBase: string): Promise<RawSegment[] | null> {
  const sb = config.sponsorblock;
  const prefix = crypto.createHash("sha256").update(videoId).digest("hex").slice(0, sb.hashPrefixLen);
  const url = `${apiBase}/api/skipSegments/${prefix}` + `?categories=${encodeURIComponent(JSON.stringify(FETCH_CATEGORIES))}` + `&actionTypes=${encodeURIComponent(JSON.stringify(FETCH_ACTION_TYPES))}`;

  let answer: Answer;
  try {
    answer = await http.read(url, { headers: { "User-Agent": config.userAgents.bot }, signal: AbortSignal.timeout(sb.timeoutMs) }, judgeSegments);
  } catch (error) {
    log.debug(`SponsorBlock 조회 실패: ${videoId} | ${messageOf(error)}`);
    return null;
  }
  if ("failed" in answer) {
    if (answer.notApi) wrongAnswer.fail(`${apiBase}의 응답이 SponsorBlock 구간 API 응답이 아님(${answer.failed}). SponsorBlock API 주소와 해시 접두어 길이 설정을 확인하세요`);
    else log.debug(`SponsorBlock 조회 실패: ${videoId} | ${answer.failed}`);
    return null;
  }
  wrongAnswer.ok();
  return answer.videos
    .filter((v) => v.videoID === videoId)
    .flatMap((v) =>
      (v.segments || []).map((s) => ({
        category: s.category,
        actionType: s.actionType,
        start: Array.isArray(s.segment) ? s.segment[0] : undefined,
        end: Array.isArray(s.segment) ? s.segment[1] : undefined,
        votes: s.votes ?? 0,
        locked: s.locked ? 1 : 0,
      })),
    );
}

/** 다시 받을 때가 됐나: 지금 주소에서 받지 않았거나, 받은 지 오래됐다(구간 없음은 더 짧게) */
function isStale(got: Got, now: number) {
  const sb = config.sponsorblock;
  if (got.apiBase !== sb.apiBase) return true;
  return now - got.fetchedAt >= (got.raw.length ? sb.recheckMs : sb.recheckEmptyMs);
}

/** 라이브로 받아 저장한다. 못 받았거나 그 사이 forget() 했으면 null */
async function _live(videoId: string): Promise<Got | null> {
  const apiBase = config.sponsorblock.apiBase;
  const asked = generation;
  const raw = await _fetchRaw(videoId, apiBase);
  if (!raw || asked !== generation) return null;
  const got = { raw, fetchedAt: Date.now(), apiBase };
  externalCaches.setSponsorSegments(videoId, raw, got); // write-through (빈 배열도 저장)
  return got;
}

// 처음 기억할 때. DB에 답이 있으면 곧바로 그것을 쓴다(바로 트는 첫 곡이 라이브를 기다리지 않게). 없는 영상만 라이브를 기다린다
async function _load(videoId: string, entry: Entry) {
  const cached = externalCaches.getSponsorSegments(videoId);
  if (cached) {
    entry.got = { raw: cached.segments as RawSegment[], fetchedAt: cached.fetchedAt, apiBase: cached.apiBase }; // 이 모듈이 저장한 형식
    entry.source = "cache";
    return;
  }
  const got = await _live(videoId);
  if (got) Object.assign(entry, { got, source: "live" });
  else entry.missedAt = Date.now();
}

// 답이 오래됐으면 뒤에서 한 번 다시 받는다(지금 곡은 가진 답을 쓴다). 나가 있으면 합치고, 실패하면 답을 그대로 두고 RETRY_STALE_MS 쉰다.
// 뒤에서 도는 일이라 DB_NOT_OPEN 말고는 던지지 않는다(새어 나가면 서버 문맥의 모르는 오류로 그 서버를 다시 시작하게 된다)
function _refreshIfStale(videoId: string, entry: Entry) {
  const now = Date.now();
  if (!entry.got || entry.refreshing || !isStale(entry.got, now) || now - entry.missedAt < RETRY_STALE_MS) return;
  entry.refreshing = true;
  void _live(videoId)
    .then((got) => {
      if (got) Object.assign(entry, { got, source: "live" });
      else entry.missedAt = Date.now();
    })
    .catch((error: unknown) => {
      if (codeOf(error) === "DB_NOT_OPEN") throw error;
      entry.missedAt = Date.now();
      log.debug(`SponsorBlock 구간 다시 받기 실패: ${videoId} | ${messageOf(error)}`);
    })
    .finally(() => (entry.refreshing = false));
}

/** 곡에서 YouTube videoId 추출. 소리가 영상에서 올 때만 있다(스포티파이는 영상을 찾은 뒤) */
function _trackVideoId(track: { audioUrl?: string | null; [field: string]: unknown } | null | undefined): string | null {
  return (track?.audioUrl && links.extractVideoId(track.audioUrl)) || null;
}

/**
 * 곡의 구간 · 하이라이트를 서버별 설정으로 필터링한 것. 재생 근접(미리 다운로드) · 재생 직전에 부른다.
 * 답은 영상 id로 기억해 두고, 오래되면 가진 답을 쓰면서 뒤에서 다시 받는다. 겹쳐 불러도 한 번만 조회한다.
 * 영상을 아직 모르거나(스포티파이는 찾은 뒤) 서버가 껐으면 null. DB 를 열기 전(DB_NOT_OPEN) 말고는 던지지 않는다.
 */
async function forTrack(track: { audioUrl?: string | null; [field: string]: unknown } | null | undefined, guildId: string): Promise<Segments | null> {
  const videoId = _trackVideoId(track);
  if (!videoId) return null;

  const eff = GuildSettingsManager.resolveSponsorBlock(guildId);
  if (!eff.enabled) return null;

  let entry = remembered.get(videoId);
  if (!entry || (!entry.loading && !entry.got && Date.now() - entry.missedAt >= RETRY_NONE_MS)) entry = _remember(videoId);
  if (entry.loading) await entry.loading;
  _refreshIfStale(videoId, entry);
  if (!entry.got) return { skipSegments: [], highlightAt: null, source: "none" };
  return { ...normalize(entry.got.raw, eff.categories), source: entry.source };
}

function _remember(videoId: string) {
  const entry: Entry = { loading: null, got: null, source: "none", missedAt: 0, refreshing: false };
  entry.loading = _load(videoId, entry)
    .catch((error: unknown) => {
      if (codeOf(error) === "DB_NOT_OPEN") throw error;
      entry.missedAt = Date.now();
      log.debug(`SponsorBlock 구간 조회 실패: ${videoId} | ${messageOf(error)}`);
    })
    .finally(() => (entry.loading = null));
  remembered.delete(videoId);
  remembered.set(videoId, entry);
  const oldest = remembered.keys().next().value;
  if (remembered.size > REMEMBER_MAX && oldest !== undefined) remembered.delete(oldest);
  return entry;
}

/** 기억한 구간을 버린다(오디오 캐시 초기화의 바깥 서비스 데이터). 나가 있는 조회의 답도 버리고, 다음 곡부터 다시 조회한다 */
function forget() {
  generation++;
  remembered.clear();
}

export { _trackVideoId, forTrack, forget, useFetch };
export const _internal = { mergeIntervals, normalize };

export type { RawSegment, SkipSegment, Segments };
