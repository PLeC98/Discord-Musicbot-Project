// src/sources/sponsor-block.ts: 정규화/병합 순수 로직 + lookup 오케스트레이션(라이브/캐시 폴백/무동작).
// 네트워크는 가짜 fetch 를 넘기고(useFetch), 캐시는 임시 SQLite로 실제 라운드트립 검증.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as GSM from "../../src/store/guild-settings.ts";
import { table as guildTable } from "../../src/store/guild-settings.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import * as stores from "../../src/store/stores.ts";
import * as externalCaches from "../../src/store/external-caches.ts";
import * as SponsorBlock from "../../src/sources/sponsor-block.ts";
import config from "../../src/config/index.ts";
import { fake } from "../helpers/fake.ts";
import sink from "../../src/infra/log/sink.ts";
import { _reset as resetLinks, linkStatus } from "../../src/infra/link-status.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-sponsorblock-test-${process.pid}`);

// 가짜 fetch 를 걸 위치. 테스트마다 net.fetch 를 정하고 SponsorBlock 에는 이것을 부르는 것을 넘긴다. 정하지 않은 테스트가 부르면 실패한다
const unset = (_init?: RequestInit): Promise<Response> => Promise.reject(new Error("테스트가 답을 정하지 않았다"));
const net = { fetch: unset };

// 실제 서버처럼 JSON 으로 답한다(구간이 없는 앞자리는 404 + [])
const JSON_TYPE = "application/json; charset=utf-8";
function reply(body: unknown, status = 200, type = JSON_TYPE) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
}

before(() => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  stores.open(DB_DIR);
  audioCache.initialize();
  config.sponsorblock.enabled = true; // 테스트 기준 활성
  SponsorBlock.useFetch(fake<typeof fetch>((_url: unknown, init?: RequestInit) => net.fetch(init)));
});

after(() => {
  SponsorBlock.useFetch(null);
  if (guildTable) audioCache.close();
  stores.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  net.fetch = unset;
  config.sponsorblock.enabled = true;
});

// SponsorBlock 해시 엔드포인트 응답 형태로 스텁 (우리 videoId의 세그먼트를 담은 한 항목).
// 실제 API처럼 항목의 videoID를 조회 대상과 일치시켜 _fetchRaw 필터를 통과하게 한다.
function stubFetch(videoId: string, segments: unknown[], { status = 200 } = {}) {
  net.fetch = async () => reply([{ videoID: videoId, hash: "0".repeat(64), segments }], status);
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
    return reply([]);
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

// 캐시가 있으면 라이브 조회를 기다리지 않는다. 기다리면 바로 트는 첫 곡이 그만큼 늦는다
test("lookup: 캐시가 있으면 곧바로 캐시로 답하고, 라이브는 뒤에서 받아 다음 답을 고친다", async () => {
  stubFetch("vidBoth", [seg("intro", 0, 8, "skip")]);
  await SponsorBlock.lookup("vidBoth", { categories: ["intro"] });
  let asked = 0;
  let answer = (_: unknown) => {};
  const answered = new Promise((done) => (answer = done));
  net.fetch = async () => {
    asked += 1;
    answer(null);
    return reply([{ videoID: "vidBoth", hash: "0".repeat(64), segments: [seg("intro", 0, 12, "skip")] }]);
  };
  const r = await SponsorBlock.lookup("vidBoth", { categories: ["intro"] });
  assert.equal(r.source, "cache");
  assert.equal(r.skipSegments[0].end, 8, "지금은 캐시(8초)");
  await answered;
  await new Promise((done) => setImmediate(done));
  assert.equal(asked, 1, "라이브는 뒤에서 한 번");
  const cached = externalCaches.getSponsorSegments("vidBoth")?.segments as Array<{ end: number }>;
  assert.equal(cached[0].end, 12, "다음 재생부터는 라이브 답");
});

// 기억해 둔 답(forTrack)도 뒤에서 받은 라이브 답으로 바뀐다
test("forTrack: 캐시로 답한 뒤 뒤에서 받은 라이브 답을 기억한다", async () => {
  SponsorBlock.forget();
  stubFetch("ytVid9", [seg("intro", 0, 5, "skip")]);
  await SponsorBlock.lookup("ytVid9", { categories: ["intro"] }); // 캐시를 채운다
  let answer = (_: unknown) => {};
  const answered = new Promise((done) => (answer = done));
  net.fetch = async () => {
    answer(null);
    return reply([{ videoID: "ytVid9", hash: "0".repeat(64), segments: [seg("intro", 0, 9, "skip")] }]);
  };
  const track = { platform: "youtube", id: "ytVid9", audioUrl: "https://youtu.be/ytVid9" };
  assert.equal((await SponsorBlock.forTrack(track, "gFresh"))?.source, "cache");
  await answered;
  await new Promise((done) => setImmediate(done));
  const again = await SponsorBlock.forTrack({ ...track }, "gFresh");
  assert.deepEqual([again?.source, again?.skipSegments[0]?.end], ["live", 9]);
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

// ── 응답 가르기: 구간 없음이라는 답 · 구간 API 가 아닌 응답 · 실패 ─────────────────

const outcomes = () => linkStatus("sponsorblock")?.recent.map((one) => [one.ok, one.error]) ?? [];
const notices = (from: number) =>
  sink.buffer
    .slice(from)
    .filter((e) => e.text.startsWith("SponsorBlock 구간 조회") && e.level !== "debug")
    .map((e) => [e.level, e.text]);
const noneStored = (videoId: string) => (externalCaches.getSponsorSegments(videoId) ?? null) === null;

test("404 + JSON 빈 배열 · 200 + 다른 영상만은 '구간 없음'이라는 답이라 저장하고, 연결은 성공으로 한 번씩 남긴다", async () => {
  resetLinks();
  const answers = [
    reply([], 404), // 그 앞자리에 구간이 하나도 없다
    reply([]), // 미러는 빈 답도 200 이다
    reply([{ videoID: "someOtherVid", segments: [seg("intro", 0, 8)] }]),
  ];
  for (const [i, res] of answers.entries()) {
    net.fetch = async () => res;
    const r = await SponsorBlock.lookup(`vidNoSegs${i}`, { categories: ["intro"] });
    assert.deepEqual([r.source, r.skipSegments], ["live", []]);
    assert.deepEqual(externalCaches.getSponsorSegments(`vidNoSegs${i}`)?.segments, []);
  }
  assert.deepEqual(outcomes(), [
    [true, null],
    [true, null],
    [true, null],
  ]);
});

test("구간 API 가 아닌 응답은 저장하지 않고 연결 실패로 남기며, 처음 한 번 경고하고 다시 답을 받으면 한 줄", async () => {
  resetLinks();
  const from = sink.buffer.length;
  const notApi = [
    reply("<!DOCTYPE html><pre>Cannot GET /api/api/skipSegments/abcde</pre>", 404, "text/html; charset=utf-8"), // 주소 끝에 /api 를 붙여 넣었다
    reply({ message: "not found" }, 404),
    reply("Hash prefix does not match format requirements.", 200), // 앞자리를 4자만 받는 미러
    reply({ videos: [] }),
  ];
  for (const [i, res] of notApi.entries()) {
    net.fetch = async () => res;
    assert.equal((await SponsorBlock.lookup(`vidNotApi${i}`, { categories: ["intro"] })).source, "none");
    assert.ok(noneStored(`vidNotApi${i}`));
  }
  stubFetch("vidApiBack", []);
  assert.equal((await SponsorBlock.lookup("vidApiBack", { categories: ["intro"] })).source, "live");

  assert.deepEqual(outcomes(), [...notApi.map(() => [false, "구간 API 응답이 아님"]), [true, null]]);
  const base = config.sponsorblock.apiBase;
  assert.deepEqual(notices(from), [
    ["warn", `SponsorBlock 구간 조회 실패: ${base}의 응답이 SponsorBlock 구간 API 응답이 아님(HTTP 404). SponsorBlock API 주소 · 해시 접두어 길이 설정 확인`],
    ["warn", `SponsorBlock 구간 조회 실패: ${base}의 응답이 SponsorBlock 구간 API 응답이 아님(HTTP 200). SponsorBlock API 주소 · 해시 접두어 길이 설정 확인`],
    ["info", "SponsorBlock 구간 조회 복구(실패 2회)"],
  ]);
});

test("400 · 429 · 5xx · 연결 오류는 실패: 저장하지 않고 연결 실패로 남기되 주소 경고는 하지 않는다", async () => {
  resetLinks();
  const from = sink.buffer.length;
  for (const status of [400, 429, 503]) {
    net.fetch = async () => reply({ message: "x" }, status);
    assert.equal((await SponsorBlock.lookup(`vidFail${status}`, { categories: ["intro"] })).source, "none");
    assert.ok(noneStored(`vidFail${status}`));
  }
  net.fetch = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };
  assert.equal((await SponsorBlock.lookup("vidRefused", { categories: ["intro"] })).source, "none");
  assert.deepEqual(outcomes(), [
    [false, "HTTP 400"],
    [false, "HTTP 429"],
    [false, "HTTP 503"],
    [false, "ECONNREFUSED"],
  ]);
  assert.deepEqual(notices(from), []);
});

test("시간 초과는 연결 실패 timeout 으로 남는다", async (t) => {
  resetLinks();
  const timeoutMs = config.sponsorblock.timeoutMs;
  t.after(() => (config.sponsorblock.timeoutMs = timeoutMs));
  config.sponsorblock.timeoutMs = 20;
  net.fetch = (init) =>
    new Promise((_, reject) => {
      const signal = init!.signal!;
      signal.addEventListener("abort", () => reject(signal.reason as Error));
    });
  assert.equal((await SponsorBlock.lookup("vidSlow", { categories: ["intro"] })).source, "none");
  assert.deepEqual(outcomes(), [[false, "timeout"]]);
});

test("lookup: videoId 없으면 none", async () => {
  const r = await SponsorBlock.lookup("");
  assert.equal(r.source, "none");
});

// ── 서버별 유효 설정 해석 ─────────────────────────────────────────────────────

test("resolveSponsorBlock: 마스터 off면 서버 설정 무관 하드 off", () => {
  config.sponsorblock.enabled = false;
  guildTable.setGuildSponsorBlock("gMasterOff", { enabled: true, categories: ["filler"] });
  const eff = GSM.resolveSponsorBlock("gMasterOff");
  assert.equal(eff.enabled, false);
  assert.deepEqual(eff.categories, []);
});

test("resolveSponsorBlock: 마스터 on + 서버 미설정 → 기본 on + 전역 카테고리", () => {
  config.sponsorblock.enabled = true;
  const eff = GSM.resolveSponsorBlock("gUnset");
  assert.equal(eff.enabled, true);
  assert.deepEqual(eff.categories, config.sponsorblock.categories);
});

test("resolveSponsorBlock: 서버가 enabled=false로 오버라이드", () => {
  config.sponsorblock.enabled = true;
  guildTable.setGuildSponsorBlock("gOff", { enabled: false, categories: null });
  const eff = GSM.resolveSponsorBlock("gOff");
  assert.equal(eff.enabled, false);
});

test("resolveSponsorBlock: 서버가 categories 오버라이드", () => {
  config.sponsorblock.enabled = true;
  guildTable.setGuildSponsorBlock("gCats", { enabled: null, categories: ["sponsor", "filler"] });
  const eff = GSM.resolveSponsorBlock("gCats");
  assert.equal(eff.enabled, true);
  assert.deepEqual(eff.categories, ["sponsor", "filler"]);
});

// ── forTrack (곡 글루) ─────────────────────────────────────────────────────────

test("forTrack: 서버 설정으로 필터링한 구간을 돌려주고, 영상 id 로 기억해 다시 묻지 않는다", async () => {
  SponsorBlock.forget();
  stubFetch("ytVid1", [seg("music_offtopic", 0, 8, "skip")]);
  const track = { platform: "youtube", id: "ytVid1", audioUrl: "https://youtu.be/ytVid1" };
  const r = await SponsorBlock.forTrack(track, "gEnsure");
  assert.equal(r?.skipSegments.length, 1);
  assert.equal(Reflect.get(track, "sponsor"), undefined, "곡에는 붙이지 않는다");

  // 같은 영상을 다른 곡 객체로 다시 틀어도(재시작 · 복원) 다시 조회하지 않는다
  net.fetch = async () => {
    throw new Error("should not be called");
  };
  const r2 = await SponsorBlock.forTrack({ ...track }, "gEnsure");
  assert.deepEqual(r2, r);
});

test("forTrack: 겹쳐 불러도 한 번만 묻는다", async () => {
  SponsorBlock.forget();
  let asked = 0;
  net.fetch = async () => {
    asked++;
    return reply([{ videoID: "ytVidTwice", hash: "0".repeat(64), segments: [] }]);
  };
  const track = { audioUrl: "https://youtu.be/ytVidTwice" };
  await Promise.all([SponsorBlock.forTrack(track, "gEnsure"), SponsorBlock.forTrack(track, "gEnsure")]);
  assert.equal(asked, 1);
});

test("forTrack: 서버가 껐으면 null, 조회 안 함", async () => {
  SponsorBlock.forget();
  guildTable.setGuildSponsorBlock("gEnsureOff", { enabled: false, categories: null });
  let called = false;
  net.fetch = async () => {
    called = true;
    return reply([]);
  };
  const r = await SponsorBlock.forTrack({ audioUrl: "https://youtu.be/ytVid2" }, "gEnsureOff");
  assert.equal(r, null);
  assert.equal(called, false);
});

test("forTrack: 영상 id 를 모르면 null. 기억하지 않아 영상을 찾은 뒤 다시 물을 수 있다", async () => {
  SponsorBlock.forget();
  const r = await SponsorBlock.forTrack({ platform: "spotify", title: "x" }, "gEnsure"); // 영상을 아직 못 찾아 음원 주소가 없다
  assert.equal(r, null);
});

test("forTrack: 못 받은 것(none)은 잠시 기억했다가 시간이 지나면 다시 묻는다", async (t) => {
  SponsorBlock.forget();
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
