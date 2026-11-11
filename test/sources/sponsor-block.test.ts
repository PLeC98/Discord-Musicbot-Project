// src/sources/sponsor-block.ts: 정규화/병합 순수 로직 + forTrack(기억, DB 캐시, 라이브, 뒤에서 다시 받기) + 응답 구분.
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
import { cacheDb } from "../../src/store/cache-db.ts";
import * as externalCaches from "../../src/store/external-caches.ts";
import * as SponsorBlock from "../../src/sources/sponsor-block.ts";
import config from "../../src/config/index.ts";
import { fake } from "../helpers/fake.ts";
import sink from "../../src/infra/log/sink.ts";
import { _reset as resetLinks, linkStatus } from "../../src/infra/link-status.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-sponsorblock-test-${process.pid}`);

// 가짜 fetch를 걸 위치. 테스트마다 net.fetch를 정하고 SponsorBlock에는 이것을 부르는 것을 넘긴다. 정하지 않은 테스트가 부르면 실패한다
const unset = (_url: string, _init?: RequestInit): Promise<Response> => Promise.reject(new Error("테스트가 답을 정하지 않았다"));
const net = { fetch: unset };

// 실제 서버처럼 JSON으로 답한다(구간이 없는 접두어는 404 + [])
const JSON_TYPE = "application/json; charset=utf-8";
function reply(body: unknown, status = 200, type = JSON_TYPE) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
}

const BASE = config.sponsorblock.apiBase;

before(() => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  stores.open(DB_DIR);
  audioCache.initialize();
  config.sponsorblock.enabled = true; // 테스트 기준 활성
  SponsorBlock.useFetch(fake<typeof fetch>((url: unknown, init?: RequestInit) => net.fetch(String(url), init)));
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
  config.sponsorblock.apiBase = BASE;
  SponsorBlock.forget();
});

// SponsorBlock 해시 엔드포인트 응답 형태로 스텁 (우리 videoId의 세그먼트를 담은 한 항목).
// 실제 API처럼 항목의 videoID를 조회 대상과 일치시켜 _fetchRaw 필터를 통과하게 한다.
function stubFetch(videoId: string, segments: unknown[], { status = 200 } = {}) {
  net.fetch = async () => reply([{ videoID: videoId, hash: "0".repeat(64), segments }], status);
}

function seg(category: string, start: number, end: number, actionType = "skip", extra: Record<string, unknown> = {}) {
  return { category, actionType, segment: [start, end], votes: 0, locked: 0, ...extra };
}

// 실제 경로(forTrack)로 조회한다. 서버 설정이 없어 기본 카테고리(music_offtopic, intro, outro)
const ask = (videoId: string) => SponsorBlock.forTrack({ audioUrl: `https://youtu.be/${videoId}` }, "gAsk");
// 뒤에서 도는 다시 받기가 끝나게 한 바퀴씩 넘긴다
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((done) => setImmediate(done));
}
// 답을 세워 둘 수 있는 가짜. release로 답을 보낸다
function gated(answer: () => Response) {
  let open = (_: unknown) => {};
  const gate = new Promise((done) => (open = done));
  let asked = 0;
  net.fetch = async () => {
    asked++;
    await gate;
    return answer();
  };
  return { release: () => open(null), asked: () => asked };
}
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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

// ── forTrack: 기억, DB 캐시, 라이브 ──────────────────────────────────────────

test("마스터 킬스위치 off면 조회, 캐시 없이 null", async () => {
  config.sponsorblock.enabled = false;
  let called = false;
  net.fetch = async () => {
    called = true;
    return reply([]);
  };
  assert.equal(await ask("vidDisabled"), null);
  assert.equal(called, false);
});

test("DB에 없으면 라이브를 기다려 받고, 받은 때, 주소와 함께 저장한다", async () => {
  stubFetch("vidLive", [seg("music_offtopic", 0, 21, "skip", { locked: 1, votes: 41 })]);
  const r = await ask("vidLive");
  assert.equal(r?.source, "live");
  assert.equal(r?.skipSegments.length, 1);
  const cached = externalCaches.getSponsorSegments("vidLive");
  assert.equal((cached?.segments as Array<{ category: string }>)[0].category, "music_offtopic");
  assert.equal(cached?.apiBase, BASE);
  assert.ok(cached && Date.now() - cached.fetchedAt < 60_000);
});

test("조회 실패 + DB에 없음 → none, 스킵 없음", async () => {
  net.fetch = async () => {
    throw new Error("network down");
  };
  const r = await ask("vidNoCache");
  assert.equal(r?.source, "none");
  assert.deepEqual(r?.skipSegments, []);
});

// 기동 뒤(기억이 빈 채로) DB의 받은 때로 판단한다. 오래돼도 재생은 기다리지 않는다
test("DB의 답은 곧바로 쓰고, 받은 때가 지나면(구간 없음 6시간, 구간 있음 7일) 뒤에서 한 번 다시 받아 기억, DB를 바꾼다", async (t) => {
  const now = 50 * DAY;
  t.mock.timers.enable({ apis: ["Date"], now });
  externalCaches.setSponsorSegments("vidHasSegs", [{ category: "intro", actionType: "skip", start: 0, end: 8 }], { fetchedAt: now - 7 * DAY + HOUR, apiBase: BASE });
  externalCaches.setSponsorSegments("vidNoSegs", [], { fetchedAt: now - 5 * HOUR, apiBase: BASE });
  const urls: string[] = [];
  net.fetch = async (url) => {
    urls.push(url);
    return reply([{ videoID: urls.length === 1 ? "vidNoSegs" : "vidHasSegs", segments: [seg("intro", 0, 12)] }]);
  };

  assert.deepEqual([(await ask("vidHasSegs"))?.source, (await ask("vidNoSegs"))?.source], ["cache", "cache"]);
  await settle();
  assert.equal(urls.length, 0, "아직 오래되지 않았다");

  t.mock.timers.tick(HOUR);
  const noSegs = await ask("vidNoSegs");
  assert.deepEqual([noSegs?.source, noSegs?.skipSegments], ["cache", []], "지금 곡은 가진 답으로");
  await settle();
  assert.equal(urls.length, 1, "구간 없음은 6시간에");
  const again = await ask("vidNoSegs");
  assert.deepEqual([again?.source, again?.skipSegments[0]?.end], ["live", 12], "다음부터 새 답");
  assert.equal(externalCaches.getSponsorSegments("vidNoSegs")?.fetchedAt, now + HOUR, "DB의 받은 때도 바꾼다");

  assert.equal((await ask("vidHasSegs"))?.skipSegments[0]?.end, 8);
  await settle();
  assert.equal(urls.length, 2, "구간 있음은 7일에");
  assert.equal((await ask("vidHasSegs"))?.skipSegments[0]?.end, 12);
  await ask("vidNoSegs");
  await settle();
  assert.equal(urls.length, 2, "새로 받은 답은 다시 조회하지 않는다");
});

test("다시 받다 실패하면 가진 답, 받은 때를 지키고 30분 쉰 뒤 다시 조회한다", async (t) => {
  const now = 50 * DAY;
  t.mock.timers.enable({ apis: ["Date"], now });
  externalCaches.setSponsorSegments("vidStale", [{ category: "intro", actionType: "skip", start: 0, end: 8 }], { fetchedAt: now - 8 * DAY, apiBase: BASE });
  let asked = 0;
  net.fetch = async () => {
    asked++;
    return reply({ message: "down" }, 503);
  };

  assert.equal((await ask("vidStale"))?.skipSegments[0]?.end, 8);
  await settle();
  assert.equal(asked, 1);
  t.mock.timers.tick(30 * 60_000 - 1);
  assert.equal((await ask("vidStale"))?.skipSegments[0]?.end, 8, "답은 그대로 쓴다");
  await settle();
  assert.equal(asked, 1, "30분 동안은 조회하지 않는다");
  assert.equal(externalCaches.getSponsorSegments("vidStale")?.fetchedAt, now - 8 * DAY);

  t.mock.timers.tick(1);
  await ask("vidStale");
  await settle();
  assert.equal(asked, 2);
});

test("같은 영상의 다시 받기는 한 번에 하나: 나가 있는 동안 다시 틀어도 합친다", async (t) => {
  const now = 50 * DAY;
  t.mock.timers.enable({ apis: ["Date"], now });
  externalCaches.setSponsorSegments("vidCoalesce", [], { fetchedAt: now - 7 * HOUR, apiBase: BASE });
  const live = gated(() => reply([{ videoID: "vidCoalesce", segments: [seg("intro", 0, 5)] }]));
  for (let i = 0; i < 3; i++) assert.equal((await ask("vidCoalesce"))?.source, "cache", "기다리지 않는다");
  await settle();
  assert.equal(live.asked(), 1);
  live.release();
  await settle();
  assert.equal((await ask("vidCoalesce"))?.source, "live");
  assert.equal(live.asked(), 1);
});

test("다른 주소에서 받은 답(주소를 바꿨거나 주소를 모르는 답)은 오래된 것으로 보고 뒤에서 지금 주소로 다시 받는다", async () => {
  externalCaches.setSponsorSegments("vidOldBase", [], { fetchedAt: Date.now(), apiBase: BASE });
  cacheDb.get().prepare("UPDATE sponsorblock_cache SET api_base = NULL WHERE video_id = ?").run("vidOldBase");
  const urls: string[] = [];
  net.fetch = async (url) => {
    urls.push(url);
    return reply([{ videoID: urls.length === 1 ? "vidOldBase" : "vidMoved", segments: [seg("intro", 0, 5)] }]);
  };
  assert.equal((await ask("vidOldBase"))?.source, "cache");
  await settle();
  assert.equal(externalCaches.getSponsorSegments("vidOldBase")?.apiBase, BASE);

  assert.equal((await ask("vidMoved"))?.source, "live");
  config.sponsorblock.apiBase = "https://new-mirror.example";
  assert.equal((await ask("vidMoved"))?.skipSegments[0]?.end, 5, "지금 곡은 가진 답으로");
  await settle();
  assert.ok(urls[2]?.startsWith("https://new-mirror.example/api/skipSegments/"), urls[2]);
  assert.equal(externalCaches.getSponsorSegments("vidMoved")?.apiBase, "https://new-mirror.example");
});

test("오디오 캐시 초기화(forget) 뒤에 도착한 옛 응답은 기억, 저장하지 않는다", async () => {
  const late = gated(() => reply([{ videoID: "vidLate", segments: [seg("intro", 0, 5)] }]));
  const playing = ask("vidLate");
  await settle();
  SponsorBlock.forget();
  late.release();
  assert.equal((await playing)?.source, "none");
  assert.equal(externalCaches.getSponsorSegments("vidLate"), null);

  stubFetch("vidLate", [seg("intro", 0, 6)]);
  assert.equal((await ask("vidLate"))?.skipSegments[0]?.end, 6, "다음 곡부터 다시 조회한다");
});

// ── 응답 구분: 구간 없음이라는 답, 구간 API가 아닌 응답, 실패 ─────────────────

const outcomes = () => linkStatus("sponsorblock")?.recent.map((one) => [one.ok, one.error]) ?? [];
const notices = (from: number) =>
  sink.buffer
    .slice(from)
    .filter((e) => e.text.startsWith("SponsorBlock 구간 조회") && e.level !== "debug")
    .map((e) => [e.level, e.text]);
const noneStored = (videoId: string) => externalCaches.getSponsorSegments(videoId) === null;

test("404 + JSON 빈 배열, 200 + 이 영상의 빈 구간, 200 + 다른 영상만은 '구간 없음'이라는 답이라 저장하고, 연결은 성공으로 한 번씩 남긴다", async () => {
  resetLinks();
  const answers = [
    reply([], 404), // 그 접두어에 구간이 하나도 없다
    reply([]), // 미러는 빈 답도 200이다
    reply([{ videoID: "vidNoSegs2", segments: [] }]),
    reply([{ videoID: "someOtherVid", segments: [seg("intro", 0, 8)] }]),
  ];
  for (const [i, res] of answers.entries()) {
    net.fetch = async () => res;
    const r = await ask(`vidNoSegs${i}`);
    assert.deepEqual([r?.source, r?.skipSegments], ["live", []]);
    assert.deepEqual(externalCaches.getSponsorSegments(`vidNoSegs${i}`)?.segments, []);
  }
  assert.deepEqual(
    outcomes(),
    answers.map(() => [true, null]),
  );
});

test("구간 API가 아닌 응답은 저장하지 않고 연결 실패로 남기며, 처음 한 번 경고하고 다시 답을 받으면 한 줄", async () => {
  resetLinks();
  const from = sink.buffer.length;
  const notApi = [
    reply("<!DOCTYPE html><pre>Cannot GET /api/api/skipSegments/abcde</pre>", 404, "text/html; charset=utf-8"), // 주소 끝에 /api를 붙여 넣었다
    reply({ message: "not found" }, 404),
    reply("Hash prefix does not match format requirements.", 200), // 접두어를 4자만 받는 미러
    reply({ videos: [] }),
  ];
  for (const [i, res] of notApi.entries()) {
    net.fetch = async () => res;
    assert.equal((await ask(`vidNotApi${i}`))?.source, "none");
    assert.ok(noneStored(`vidNotApi${i}`));
  }
  stubFetch("vidApiBack", []);
  assert.equal((await ask("vidApiBack"))?.source, "live");

  assert.deepEqual(outcomes(), [...notApi.map(() => [false, "구간 API 응답이 아님"]), [true, null]]);
  assert.deepEqual(notices(from), [
    ["warn", `SponsorBlock 구간 조회 실패: ${BASE}의 응답이 SponsorBlock 구간 API 응답이 아님(HTTP 404). SponsorBlock API 주소와 해시 접두어 길이 설정을 확인하세요`],
    ["warn", `SponsorBlock 구간 조회 실패: ${BASE}의 응답이 SponsorBlock 구간 API 응답이 아님(HTTP 200). SponsorBlock API 주소와 해시 접두어 길이 설정을 확인하세요`],
    ["info", "SponsorBlock 구간 조회 복구(실패 2회)"],
  ]);
});

test("400, 429, 5xx, 연결 오류는 실패: 저장하지 않고 연결 실패로 남기되 주소 경고는 하지 않는다", async () => {
  resetLinks();
  const from = sink.buffer.length;
  for (const status of [400, 429, 503]) {
    net.fetch = async () => reply({ message: "x" }, status);
    assert.equal((await ask(`vidFail${status}`))?.source, "none");
    assert.ok(noneStored(`vidFail${status}`));
  }
  net.fetch = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };
  assert.equal((await ask("vidRefused"))?.source, "none");
  assert.deepEqual(outcomes(), [
    [false, "HTTP 400"],
    [false, "HTTP 429"],
    [false, "HTTP 503"],
    [false, "ECONNREFUSED"],
  ]);
  assert.deepEqual(notices(from), []);
});

test("API 요청 실패는 까닭마다 처음 한 번 경고하고, 다시 답을 받으면 한 줄", async () => {
  stubFetch("vidApiUp0", []);
  assert.equal((await ask("vidApiUp0"))?.source, "live");
  const from = sink.buffer.length;
  net.fetch = async () => reply({ message: "x" }, 503);
  for (const id of ["vidDown0", "vidDown1"]) assert.equal((await ask(id))?.source, "none");
  net.fetch = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };
  for (const id of ["vidDown2", "vidDown3"]) assert.equal((await ask(id))?.source, "none");
  stubFetch("vidApiUp1", []);
  assert.equal((await ask("vidApiUp1"))?.source, "live");

  const lines = sink.buffer
    .slice(from)
    .filter((e) => e.text.startsWith("SponsorBlock API 요청"))
    .map((e) => [e.level, e.text]);
  assert.deepEqual(lines, [
    ["warn", `SponsorBlock API 요청 실패: HTTP 503 (${BASE})`],
    ["warn", `SponsorBlock API 요청 실패: ECONNREFUSED (${BASE})`],
    ["info", "SponsorBlock API 요청 복구(실패 2회)"],
  ]);
});

test("시간 초과는 연결 실패 timeout으로 남는다", async (t) => {
  resetLinks();
  const timeoutMs = config.sponsorblock.timeoutMs;
  t.after(() => (config.sponsorblock.timeoutMs = timeoutMs));
  config.sponsorblock.timeoutMs = 20;
  net.fetch = (_url, init) =>
    new Promise((_, reject) => {
      const signal = init!.signal!;
      signal.addEventListener("abort", () => reject(signal.reason as Error));
    });
  assert.equal((await ask("vidSlow"))?.source, "none");
  assert.deepEqual(outcomes(), [[false, "timeout"]]);
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

  // 같은 영상을 다른 곡 객체로 다시 틀어도(재시작, 복원) 다시 조회하지 않는다
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
