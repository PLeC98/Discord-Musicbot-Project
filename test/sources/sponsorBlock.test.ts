// src/sources/sponsorBlock.ts — 정규화/병합 순수 로직 + lookup 오케스트레이션(라이브/캐시 폴백/무동작).
// 네트워크는 global.fetch 스텁으로 대체, 캐시는 임시 SQLite로 실제 라운드트립 검증.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";
import { table as guildTable } from "../../src/store/guildSettings.ts";
import * as audioCache from "../../src/store/audioCache.ts";
import * as externalCaches from "../../src/store/externalCaches.ts";
import * as SponsorBlock from "../../src/sources/sponsorBlock.ts";
import config from "../../config.ts";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const DB_PATH = path.join(os.tmpdir(), `musicbot-sponsorblock-test-${process.pid}.db`);

const realFetch = global.fetch;
// 가짜 fetch 를 걸 자리. 가짜 응답은 SponsorBlock 이 읽는 칸(status · json)만 가진다
const net = global as unknown as { fetch: () => Promise<{ status: number; json(): Promise<unknown> }> };

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  audioCache.initialize(DB_PATH);
  config.sponsorblock.enabled = true; // 테스트 기준 활성
});

after(() => {
  global.fetch = realFetch;
  if (guildTable) audioCache.close();
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
function stubFetch(videoId: string, segments: unknown[], { status = 200 } = {}) {
  net.fetch = async () => ({
    status,
    json: async () => [{ videoID: videoId, hash: "0".repeat(64), segments }],
  });
}

function seg(category: string, start: number, end: number, actionType = "skip", extra: Record<string, unknown> = {}) {
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
  net.fetch = async () => {
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
  assert.equal(r?.skipSegments.length, 1);
  // 캐시에 원시 세그먼트가 저장됐는지
  const cached = externalCaches.getSponsorSegments("vidLive");
  const segments = cached?.segments as Array<{ category: string }> | undefined;
  assert.ok(segments && segments.length === 1);
  assert.equal(segments[0].category, "music_offtopic");
});

test("lookup: 조회 실패 + 캐시 있음 → source cache (폴백)", async () => {
  // 먼저 라이브로 캐시 채우고
  stubFetch("vidFallback", [seg("intro", 0, 8, "skip")]);
  await SponsorBlock.lookup("vidFallback", { categories: ["intro"] });
  // 이후 조회는 실패
  net.fetch = async () => {
    throw new Error("network down");
  };
  const r = await SponsorBlock.lookup("vidFallback", { categories: ["intro"] });
  assert.equal(r.source, "cache");
  assert.equal(r?.skipSegments.length, 1);
});

test("lookup: 조회 실패 + 캐시 없음 → source none, 스킵 없음", async () => {
  net.fetch = async () => {
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
  const cached = externalCaches.getSponsorSegments("vidEmpty");
  assert.ok(cached && Array.isArray(cached.segments) && cached.segments.length === 0);
});

test("lookup: videoId 없으면 none", async () => {
  const r = await SponsorBlock.lookup("");
  assert.equal(r.source, "none");
});

// ── 서버별 유효 설정 해석 ─────────────────────────────────────────────────────

test("resolveSponsorBlock: 마스터 off면 서버 설정 무관 하드 off", () => {
  const GSM = require("../../src/store/guildSettings.ts");
  config.sponsorblock.enabled = false;
  guildTable.setGuildSponsorBlock("gMasterOff", { enabled: true, categories: ["filler"] });
  const eff = GSM.resolveSponsorBlock("gMasterOff");
  assert.equal(eff.enabled, false);
  assert.deepEqual(eff.categories, []);
});

test("resolveSponsorBlock: 마스터 on + 서버 미설정 → 기본 on + 전역 카테고리", () => {
  const GSM = require("../../src/store/guildSettings.ts");
  config.sponsorblock.enabled = true;
  const eff = GSM.resolveSponsorBlock("gUnset");
  assert.equal(eff.enabled, true);
  assert.deepEqual(eff.categories, config.sponsorblock.categories);
});

test("resolveSponsorBlock: 서버가 enabled=false로 오버라이드", () => {
  const GSM = require("../../src/store/guildSettings.ts");
  config.sponsorblock.enabled = true;
  guildTable.setGuildSponsorBlock("gOff", { enabled: false, categories: null });
  const eff = GSM.resolveSponsorBlock("gOff");
  assert.equal(eff.enabled, false);
});

test("resolveSponsorBlock: 서버가 categories 오버라이드", () => {
  const GSM = require("../../src/store/guildSettings.ts");
  config.sponsorblock.enabled = true;
  guildTable.setGuildSponsorBlock("gCats", { enabled: null, categories: ["sponsor", "filler"] });
  const eff = GSM.resolveSponsorBlock("gCats");
  assert.equal(eff.enabled, true);
  assert.deepEqual(eff.categories, ["sponsor", "filler"]);
});

// ── forTrack (곡 글루) ─────────────────────────────────────────────────────────

test("forTrack: 서버 설정으로 거른 구간을 돌려주고, 영상 id 로 기억해 다시 묻지 않는다", async () => {
  SponsorBlock._forget();
  stubFetch("ytVid1", [seg("music_offtopic", 0, 8, "skip")]);
  const track = { platform: "youtube", id: "ytVid1", audioUrl: "https://youtu.be/ytVid1" };
  const r = await SponsorBlock.forTrack(track, "gEnsure");
  assert.equal(r?.skipSegments.length, 1);
  assert.equal(Reflect.get(track, "sponsor"), undefined, "곡에는 붙이지 않는다");

  // 같은 영상을 다른 곡 객체로 다시 틀어도(재시작 · 복원) 묻지 않는다
  net.fetch = async () => {
    throw new Error("should not be called");
  };
  const r2 = await SponsorBlock.forTrack({ ...track }, "gEnsure");
  assert.deepEqual(r2, r);
});

test("forTrack: 겹쳐 불러도 한 번만 묻는다", async () => {
  SponsorBlock._forget();
  let asked = 0;
  net.fetch = async () => {
    asked++;
    return { status: 200, json: async () => [{ videoID: "ytVidTwice", hash: "0".repeat(64), segments: [] }] };
  };
  const track = { audioUrl: "https://youtu.be/ytVidTwice" };
  await Promise.all([SponsorBlock.forTrack(track, "gEnsure"), SponsorBlock.forTrack(track, "gEnsure")]);
  assert.equal(asked, 1);
});

test("forTrack: 서버가 껐으면 null, 조회 안 함", async () => {
  SponsorBlock._forget();
  guildTable.setGuildSponsorBlock("gEnsureOff", { enabled: false, categories: null });
  let called = false;
  net.fetch = async () => {
    called = true;
    return { status: 200, json: async () => [] };
  };
  const r = await SponsorBlock.forTrack({ audioUrl: "https://youtu.be/ytVid2" }, "gEnsureOff");
  assert.equal(r, null);
  assert.equal(called, false);
});

test("forTrack: 영상 id 를 모르면 null. 기억하지 않아 영상을 찾은 뒤 다시 물을 수 있다", async () => {
  SponsorBlock._forget();
  const r = await SponsorBlock.forTrack({ platform: "spotify", title: "x" }, "gEnsure"); // 영상을 아직 못 찾아 음원 주소가 없다
  assert.equal(r, null);
});

test("forTrack: 못 받은 것(none)은 잠시 기억했다가 시간이 지나면 다시 묻는다", async (t) => {
  SponsorBlock._forget();
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  let asked = 0;
  net.fetch = async () => {
    asked++;
    throw new Error("network down");
  };
  const track = { audioUrl: "https://youtu.be/ytVidNone" };
  assert.equal((await SponsorBlock.forTrack(track, "gEnsure"))?.source, "none");
  await SponsorBlock.forTrack(track, "gEnsure");
  assert.equal(asked, 1, "바로 다시 틀 때는 묻지 않는다");

  t.mock.timers.tick(10 * 60_000);
  await SponsorBlock.forTrack(track, "gEnsure");
  assert.equal(asked, 2);
});

test("영상 id 는 음원 주소에서만 읽는다. 곡이 어디서 왔는지는 상관없다", () => {
  assert.equal(SponsorBlock._trackVideoId({ platform: "youtube", audioUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }), "aaaaaaaaaaa");
  assert.equal(SponsorBlock._trackVideoId({ platform: "vocadb", pageUrl: "https://vocadb.net/S/1", audioUrl: "https://youtu.be/bbbbbbbbbbb" }), "bbbbbbbbbbb");
  assert.equal(SponsorBlock._trackVideoId({ platform: "spotify" }), null, "영상을 찾기 전");
  assert.equal(SponsorBlock._trackVideoId({ platform: "anisongdb", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3" }), null, "음원 곡");
  assert.equal(SponsorBlock._trackVideoId(null), null);
});
