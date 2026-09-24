// SponsorBlock. 영상별 비음악/인트로/아웃트로 등 구간을 SponsorBlock API로 조회해 자동 스킵에 사용.
//
// 설계:
//  - 프라이버시 해시-프리픽스 엔드포인트로 조회 (어떤 영상을 트는지 서버에 노출 안 함).
//  - 원시 세그먼트(카테고리 전부)를 write-through 캐시에 저장, 정규화/필터는 읽을 때 카테고리별로 수행.
//  - fail-open: 라이브 조회 실패/타임아웃 시 캐시 폴백, 그마저 없으면 스킵 없이 진행.
//  - config.sponsorblock.enabled=false 면 API·캐시 전부 무동작(상업적 이용용 마스터 킬스위치).
//
// 세그먼트 데이터: https://sponsor.ajay.app (CC BY-NC-SA 4.0).

import crypto from "crypto";
import * as links from "../rules/links.ts";
import config from "../../config.ts";
import * as GuildSettingsManager from "../store/guildSettings.ts";
import * as externalCaches from "../store/externalCaches.ts";

/** 원시 구간 하나(카테고리 전부). 캐시에도 이 모양으로 담는다 */
type RawSegment = { category: string; actionType: string; start?: number; end?: number; votes: number; locked: number };
/** 병합한 스킵 구간 */
type SkipSegment = { start: number; end: number; categories: string[] };
type Source = "live" | "cache" | "none" | "disabled";
type Fetched = { raw: RawSegment[] | null; source: Source };
/** 곡에 걸 구간 · 하이라이트 */
type Segments = { skipSegments: SkipSegment[]; highlightAt: number | null; source: Source };
// API 응답(해시 앞자리에 걸린 영상들). 여기서 읽는 칸만
type ApiVideo = { hash?: string; videoID?: string; segments?: Array<{ category: string; actionType: string; segment?: unknown; votes?: number; locked?: unknown }> };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// skip 지원 9개 카테고리 (config.js의 SB_SKIP_CATEGORIES와 동기 유지)
const SKIP_CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler", "music_offtopic"];
// 조회 시 항상 전 카테고리 + 하이라이트를 받아 캐시를 카테고리-완전하게 유지 (서버별 필터는 읽을 때)
const FETCH_CATEGORIES = [...SKIP_CATEGORIES, "poi_highlight"];
const FETCH_ACTION_TYPES = ["skip", "poi"];

// 영상 id 로 기억한 조회 결과(DB 캐시 앞의 메모리 기억). 같은 곡을 다시 틀 때 묻지 않는다.
// 서버마다 카테고리가 달라 거르기 전의 원시 구간을 기억한다.
const remembered = new Map<string, { at: number; none: boolean; promise: Promise<Fetched> }>();
const REMEMBER_MAX = 500;
const RETRY_NONE_MS = 10 * 60_000; // 못 받은 것은 이만큼 지나 다시 묻는다

// 겹치거나 맞닿은 skip 구간을 합집합으로 병합. 기여한 카테고리는 union으로 보존
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
//  - skipSegments: enabledCategories에 속한 skip 구간을 병합한 [{start,end,categories}]
//  - highlightAt: poi_highlight 지점(최다 득표) 초 단위 또는 null (하이라이트 기능용, §J)
function normalize(raw: RawSegment[] | null | undefined, enabledCategories: Iterable<string>) {
  const enabled = new Set(enabledCategories);
  const skips = (raw || []).flatMap((s) => (s.actionType === "skip" && enabled.has(s.category) && finite(s.start) && finite(s.end) && s.end > s.start ? [{ start: s.start, end: s.end, category: s.category }] : []));
  const skipSegments = mergeIntervals(skips);

  const pois = (raw || []).filter((s): s is RawSegment & { start: number } => s.actionType === "poi" && s.category === "poi_highlight" && finite(s.start));
  const highlightAt = pois.length ? pois.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0].start : null;

  return { skipSegments, highlightAt };
}

/**
 * videoId의 라이브 조회 → 원시 세그먼트 배열, 실패 시 null.
 * 200 + 배열이면 성공(우리 영상 세그먼트 없으면 빈 배열. 이는 실패 아님, "구간 없음").
 * 네트워크/타임아웃(abort)/비200/비배열 → null(=폴백 트리거).
 */
async function _fetchRaw(videoId: string): Promise<RawSegment[] | null> {
  const sb = config.sponsorblock;
  const fullHash = crypto.createHash("sha256").update(videoId).digest("hex");
  const prefix = fullHash.slice(0, sb.hashPrefixLen);
  const url = `${sb.apiBase}/api/skipSegments/${prefix}` + `?categories=${encodeURIComponent(JSON.stringify(FETCH_CATEGORIES))}` + `&actionTypes=${encodeURIComponent(JSON.stringify(FETCH_ACTION_TYPES))}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), sb.timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": config.userAgents.bot }, signal: controller.signal });
    if (res.status !== 200) return null;
    const arr: unknown = await res.json();
    if (!Array.isArray(arr)) return null;
    const mine = (arr as ApiVideo[]).filter((v) => v.hash === fullHash || v.videoID === videoId);
    return mine.flatMap((v) =>
      (v.segments || []).map((s) => ({
        category: s.category,
        actionType: s.actionType,
        start: Array.isArray(s.segment) ? s.segment[0] : undefined,
        end: Array.isArray(s.segment) ? s.segment[1] : undefined,
        votes: s.votes ?? 0,
        locked: s.locked ? 1 : 0,
      })),
    );
  } catch {
    return null; // abort/네트워크 오류 → 폴백
  } finally {
    clearTimeout(timer);
  }
}

/**
 * videoId의 스킵/하이라이트 정보 조회.
 * @param {string} videoId
 * @param {{categories?: string[]}} opts  enabledCategories(서버별 해석 결과). 미지정 시 config 기본.
 * @returns {Promise<{skipSegments:Array,highlightAt:number|null,source:'live'|'cache'|'none'|'disabled'}>}
 */
async function lookup(videoId: string | null | undefined, { categories = config.sponsorblock.categories }: { categories?: string[] } = {}): Promise<Segments> {
  if (!config.sponsorblock.enabled) return { skipSegments: [], highlightAt: null, source: "disabled" };
  if (!videoId) return { skipSegments: [], highlightAt: null, source: "none" };

  return shape(await _rawFor(videoId), categories);
}

/** 원시 구간과 출처. 라이브 조회를 먼저, 실패하면 DB 캐시 */
async function _rawFor(videoId: string): Promise<Fetched> {
  const raw = await _fetchRaw(videoId);
  if (raw) {
    externalCaches.setSponsorSegments(videoId, raw); // write-through (빈 배열도 저장)
    return { raw, source: "live" };
  }
  const cached = externalCaches.getSponsorSegments(videoId);
  if (cached) return { raw: cached.segments as RawSegment[], source: "cache" }; // 우리가 적은 모양
  return { raw: null, source: "none" };
}

/** 트랙에서 YouTube videoId 추출. 소리가 영상에서 올 때만 있다(스포티파이는 영상을 찾은 뒤) */
function _trackVideoId(track: { audioUrl?: string | null } | null | undefined): string | null {
  return (track?.audioUrl && links.extractVideoId(track.audioUrl)) || null;
}

/**
 * 곡의 구간 · 하이라이트를 서버별 설정으로 거른 것. 재생 근접(미리 받기) · 재생 직전에 부른다.
 * 조회는 영상 id 로 기억해 두고 다시 묻지 않는다. 겹쳐 불러도 한 번만 묻는다.
 * 영상을 아직 모르거나(스포티파이는 찾은 뒤) 서버가 껐으면 null. 예외를 던지지 않는다.
 * @returns {Promise<{skipSegments:Array,highlightAt:number|null,source:string}|null>}
 */
async function forTrack(track: { audioUrl?: string | null } | null | undefined, guildId: string): Promise<Segments | null> {
  const videoId = _trackVideoId(track);
  if (!videoId) return null;

  const eff = GuildSettingsManager.resolveSponsorBlock(guildId);
  if (!eff.enabled) return null;
  if (!config.sponsorblock.enabled) return { skipSegments: [], highlightAt: null, source: "disabled" };

  let entry = remembered.get(videoId);
  if (!entry || (entry.none && Date.now() - entry.at >= RETRY_NONE_MS)) entry = _remember(videoId);
  return shape(await entry.promise, eff.categories);
}

function _remember(videoId: string) {
  const at = Date.now();
  const promise = _rawFor(videoId)
    .catch((): Fetched => ({ raw: null, source: "none" }))
    .then((r) => {
      entry.none = !r.raw;
      return r;
    });
  const entry = { at, none: false, promise };
  remembered.delete(videoId);
  remembered.set(videoId, entry);
  const oldest = remembered.keys().next().value;
  if (remembered.size > REMEMBER_MAX && oldest !== undefined) remembered.delete(oldest);
  return entry;
}

function _forget() {
  remembered.clear();
}

function shape({ raw, source }: Fetched, categories: Iterable<string>): Segments {
  if (!raw) return { skipSegments: [], highlightAt: null, source };
  return { ...normalize(raw, categories), source };
}

const SponsorBlock = { _fetchRaw, lookup, _rawFor, _trackVideoId, forTrack, _remember, _forget, SKIP_CATEGORIES, _internal: { mergeIntervals, normalize } };

export default SponsorBlock;
export type { RawSegment, SkipSegment, Segments };
export { SponsorBlock as "module.exports" };
