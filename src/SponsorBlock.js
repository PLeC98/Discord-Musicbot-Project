"use strict";

// SponsorBlock — 영상별 비음악/인트로/아웃트로 등 구간을 SponsorBlock API로 조회해 자동 스킵에 사용.
//
// 설계(notes/sponsorblock-plan 참조):
//  - 프라이버시 해시-프리픽스 엔드포인트로 조회 (어떤 영상을 트는지 서버에 노출 안 함).
//  - 원시 세그먼트(카테고리 전부)를 write-through 캐시에 저장, 정규화/필터는 읽을 때 카테고리별로 수행.
//  - fail-open: 라이브 조회 실패/타임아웃 시 캐시 폴백, 그마저 없으면 스킵 없이 진행.
//  - config.sponsorblock.enabled=false 면 API·캐시 전부 무동작(상업적 이용용 마스터 킬스위치).
//
// 세그먼트 데이터: https://sponsor.ajay.app (CC BY-NC-SA 4.0).

const crypto = require("crypto");
const config = require("../config");
const CacheManager = require("./CacheManager");
const pkg = require("../package.json");

// skip 지원 9개 카테고리 (config.js의 SB_SKIP_CATEGORIES와 동기 유지)
const SKIP_CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "hook", "filler", "music_offtopic"];
// 조회 시 항상 전 카테고리 + 하이라이트를 받아 캐시를 카테고리-완전하게 유지 (서버별 필터는 읽을 때)
const FETCH_CATEGORIES = [...SKIP_CATEGORIES, "poi_highlight"];
const FETCH_ACTION_TYPES = ["skip", "poi"];

const USER_AGENT = `Discord-Musicbot-Project/${pkg.version} (+${config.bot.projectRepo})`;

// 겹치거나 맞닿은 skip 구간을 합집합으로 병합 — 기여한 카테고리는 union으로 보존
function mergeIntervals(segs) {
  if (!segs.length) return [];
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out = [];
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
function normalize(raw, enabledCategories) {
  const enabled = new Set(enabledCategories);
  const skips = (raw || []).filter((s) => s.actionType === "skip" && enabled.has(s.category) && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start).map((s) => ({ start: s.start, end: s.end, category: s.category }));
  const skipSegments = mergeIntervals(skips);

  const pois = (raw || []).filter((s) => s.actionType === "poi" && s.category === "poi_highlight" && Number.isFinite(s.start));
  const highlightAt = pois.length ? pois.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0].start : null;

  return { skipSegments, highlightAt };
}

const SponsorBlock = {
  SKIP_CATEGORIES,
  _internal: { mergeIntervals, normalize },

  /**
   * videoId의 라이브 조회 → 원시 세그먼트 배열, 실패 시 null.
   * 200 + 배열이면 성공(우리 영상 세그먼트 없으면 빈 배열 — 이는 실패 아님, "구간 없음").
   * 네트워크/타임아웃(abort)/비200/비배열 → null(=폴백 트리거).
   */
  async _fetchRaw(videoId) {
    const sb = config.sponsorblock;
    const fullHash = crypto.createHash("sha256").update(videoId).digest("hex");
    const prefix = fullHash.slice(0, sb.hashPrefixLen);
    const url = `${sb.apiBase}/api/skipSegments/${prefix}` + `?categories=${encodeURIComponent(JSON.stringify(FETCH_CATEGORIES))}` + `&actionTypes=${encodeURIComponent(JSON.stringify(FETCH_ACTION_TYPES))}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), sb.timeoutMs);
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
      if (res.status !== 200) return null;
      const arr = await res.json();
      if (!Array.isArray(arr)) return null;
      const mine = arr.filter((v) => v.hash === fullHash || v.videoID === videoId);
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
  },

  /**
   * videoId의 스킵/하이라이트 정보 조회.
   * @param {string} videoId
   * @param {{categories?: string[]}} opts  enabledCategories(서버별 해석 결과). 미지정 시 config 기본.
   * @returns {Promise<{skipSegments:Array,highlightAt:number|null,source:'live'|'cache'|'none'|'disabled'}>}
   */
  async lookup(videoId, { categories = config.sponsorblock.categories } = {}) {
    if (!config.sponsorblock.enabled) return { skipSegments: [], highlightAt: null, source: "disabled" };
    if (!videoId) return { skipSegments: [], highlightAt: null, source: "none" };

    let raw = await this._fetchRaw(videoId);
    let source;
    if (raw) {
      CacheManager.setSponsorSegments(videoId, raw); // write-through (빈 배열도 저장)
      source = "live";
    } else {
      const cached = CacheManager.getSponsorSegments(videoId);
      if (cached) {
        raw = cached.segments;
        source = "cache";
      } else {
        return { skipSegments: [], highlightAt: null, source: "none" };
      }
    }
    return { ...normalize(raw, categories), source };
  },
};

module.exports = SponsorBlock;
