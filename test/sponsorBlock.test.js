"use strict";

// src/SponsorBlock.js — 정규화/병합 순수 로직 + lookup 오케스트레이션(라이브/캐시 폴백/무동작).
// 네트워크는 global.fetch 스텁으로 대체, 캐시는 임시 SQLite로 실제 라운드트립 검증.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const DB_PATH = path.join(os.tmpdir(), `musicbot-sponsorblock-test-${process.pid}.db`);

let SponsorBlock;
let CacheManager;
let config;
const realFetch = global.fetch;

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  CacheManager = require("../src/CacheManager");
  CacheManager.initialize(DB_PATH);
  SponsorBlock = require("../src/SponsorBlock");
  config = require("../config");
  config.sponsorblock.enabled = true; // 테스트 기준 활성
});

after(() => {
  global.fetch = realFetch;
  if (CacheManager) CacheManager.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    /* 무시 */
  }
});

beforeEach(() => {
  global.fetch = realFetch;
  config.sponsorblock.enabled = true;
});

// SponsorBlock 해시 엔드포인트 응답 형태로 스텁 (우리 videoId의 세그먼트를 담은 한 항목).
// 실제 API처럼 항목의 videoID를 조회 대상과 일치시켜 _fetchRaw 필터를 통과하게 한다.
function stubFetch(videoId, segments, { status = 200 } = {}) {
  global.fetch = async () => ({
    status,
    json: async () => [{ videoID: videoId, hash: "0".repeat(64), segments }],
  });
}

function seg(category, start, end, actionType = "skip", extra = {}) {
  return { category, actionType, segment: [start, end], votes: 0, locked: 0, ...extra };
}

// ── 순수 정규화/병합 ──────────────────────────────────────────────────────────

test("normalize: enabledCategories로 skip 필터링", () => {
  const raw = [
    { category: "music_offtopic", actionType: "skip", start: 0, end: 10 },
    { category: "filler", actionType: "skip", start: 20, end: 25 },
  ];
  const { skipSegments } = SponsorBlock._internal.normalize(raw, ["music_offtopic"]);
  assert.equal(skipSegments.length, 1);
  assert.deepEqual(skipSegments[0], { start: 0, end: 10, categories: ["music_offtopic"] });
});

test("normalize: 겹치는 구간 병합 + 카테고리 union", () => {
  const raw = [
    { category: "filler", actionType: "skip", start: 222, end: 247 },
    { category: "music_offtopic", actionType: "skip", start: 222, end: 252 },
  ];
  const { skipSegments } = SponsorBlock._internal.normalize(raw, ["filler", "music_offtopic"]);
  assert.equal(skipSegments.length, 1);
  assert.equal(skipSegments[0].start, 222);
  assert.equal(skipSegments[0].end, 252);
  assert.deepEqual(skipSegments[0].categories.sort(), ["filler", "music_offtopic"]);
});

test("normalize: 떨어진 구간은 병합 안 함", () => {
  const raw = [
    { category: "intro", actionType: "skip", start: 0, end: 8 },
    { category: "outro", actionType: "skip", start: 250, end: 260 },
  ];
  const { skipSegments } = SponsorBlock._internal.normalize(raw, ["intro", "outro"]);
  assert.equal(skipSegments.length, 2);
});

test("normalize: poi_highlight는 최다 득표 지점을 highlightAt로", () => {
  const raw = [
    { category: "poi_highlight", actionType: "poi", start: 30, end: 30, votes: 2 },
    { category: "poi_highlight", actionType: "poi", start: 73, end: 73, votes: 6 },
  ];
  const { highlightAt, skipSegments } = SponsorBlock._internal.normalize(raw, ["music_offtopic"]);
  assert.equal(highlightAt, 73);
  assert.equal(skipSegments.length, 0); // poi는 스킵에 안 들어감
});

test("normalize: 잘못된 구간(끝<=시작, 비유한값) 제거", () => {
  const raw = [
    { category: "intro", actionType: "skip", start: 10, end: 5 },
    { category: "intro", actionType: "skip", start: NaN, end: 10 },
    { category: "intro", actionType: "skip", start: 0, end: 8 },
  ];
  const { skipSegments } = SponsorBlock._internal.normalize(raw, ["intro"]);
  assert.equal(skipSegments.length, 1);
  assert.deepEqual(skipSegments[0], { start: 0, end: 8, categories: ["intro"] });
});

// ── lookup 오케스트레이션 ─────────────────────────────────────────────────────

test("lookup: 마스터 킬스위치 off면 fetch/캐시 없이 disabled", async () => {
  config.sponsorblock.enabled = false;
  let called = false;
  global.fetch = async () => {
    called = true;
    return { status: 200, json: async () => [] };
  };
  const r = await SponsorBlock.lookup("vidDisabled");
  assert.equal(r.source, "disabled");
  assert.equal(called, false);
  assert.deepEqual(r.skipSegments, []);
});

test("lookup: 라이브 성공 → source live + write-through 캐시", async () => {
  stubFetch("vidLive", [seg("music_offtopic", 0, 21, "skip", { locked: 1, votes: 41 })]);
  const r = await SponsorBlock.lookup("vidLive", { categories: ["music_offtopic"] });
  assert.equal(r.source, "live");
  assert.equal(r.skipSegments.length, 1);
  // 캐시에 원시 세그먼트가 저장됐는지
  const cached = CacheManager.getSponsorSegments("vidLive");
  assert.ok(cached && cached.segments.length === 1);
  assert.equal(cached.segments[0].category, "music_offtopic");
});

test("lookup: 조회 실패 + 캐시 있음 → source cache (폴백)", async () => {
  // 먼저 라이브로 캐시 채우고
  stubFetch("vidFallback", [seg("intro", 0, 8, "skip")]);
  await SponsorBlock.lookup("vidFallback", { categories: ["intro"] });
  // 이후 조회는 실패
  global.fetch = async () => {
    throw new Error("network down");
  };
  const r = await SponsorBlock.lookup("vidFallback", { categories: ["intro"] });
  assert.equal(r.source, "cache");
  assert.equal(r.skipSegments.length, 1);
});

test("lookup: 조회 실패 + 캐시 없음 → source none, 스킵 없음", async () => {
  global.fetch = async () => {
    throw new Error("network down");
  };
  const r = await SponsorBlock.lookup("vidNoCache", { categories: ["intro"] });
  assert.equal(r.source, "none");
  assert.deepEqual(r.skipSegments, []);
});

test("lookup: 비200 응답은 실패로 처리(폴백)", async () => {
  stubFetch("vid500", [], { status: 500 });
  const r = await SponsorBlock.lookup("vid500", { categories: ["intro"] });
  assert.equal(r.source, "none"); // 캐시 없으니 none
});

test("lookup: 우리 영상 세그먼트 없음(빈 배열)은 라이브 성공 + 네거티브 캐시", async () => {
  stubFetch("vidEmpty", []); // segments 빈 배열
  const r = await SponsorBlock.lookup("vidEmpty", { categories: ["music_offtopic"] });
  assert.equal(r.source, "live");
  assert.deepEqual(r.skipSegments, []);
  const cached = CacheManager.getSponsorSegments("vidEmpty");
  assert.ok(cached && Array.isArray(cached.segments) && cached.segments.length === 0);
});

test("lookup: videoId 없으면 none", async () => {
  const r = await SponsorBlock.lookup("");
  assert.equal(r.source, "none");
});
