// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 서버별 설정(GuildSettingsManager)의 지금 동작을 고정한다(구조 리팩터링 0-B).
//
// 서버 설정 표 위에 메모리 캐시를 얹은 층이다. 설정마다 읽기 · 쓰기 · 지우기, 메모리 캐시,
// DB 가 실패했을 때 돌려주는 값을 적어 둔다. 진짜 표를 임시 DB 로 쓴다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as storeDb from "../../src/store/db.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "guild-settings-"));
const guildTable = (await import("../../src/store/guildSettings.ts")).table;
const audioCache = await import("../../src/store/audioCache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
audioCache.initialize(path.join(TMP, "cache.db"));
const settings = await import("../../src/store/guildSettings.ts");
const config = (await import("../../config.ts")).default;

beforeEach(() => {
  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings;");
});

after(() => {
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

// 메모리 캐시를 비우고 다시 읽는다. DB 에 실제로 남았는지 본다
const fresh = () => settings._reset();

// DB 를 잠깐 닫는다. 표를 부르면 던진다(DB_NOT_OPEN)
async function whenDbDown(fn) {
  audioCache.close();
  try {
    return await fn();
  } finally {
    audioCache.initialize(path.join(TMP, "cache.db"));
  }
}

test("전용 채널: 저장 · 읽기 · 지우기. 미설정은 null", async () => {
  assert.equal(await settings.getBotChannel("g1"), null);
  fresh();
  assert.equal(await settings.setBotChannel("g1", "c1"), true);
  fresh();
  assert.equal(await settings.getBotChannel("g1"), "c1");
  await settings.clearBotChannel("g1");
  assert.equal(await settings.getBotChannel("g1"), null);
});

test("DJ 역할: 저장 · 읽기 · 지우기. 미설정은 빈 배열", async () => {
  assert.deepEqual(await settings.getDjRoles("g1"), []);
  fresh();
  await settings.setDjRoles("g1", ["r1", "r2"]);
  fresh();
  assert.deepEqual(await settings.getDjRoles("g1"), ["r1", "r2"]);
  await settings.clearDjRoles("g1");
  fresh();
  assert.deepEqual(await settings.getDjRoles("g1"), []);
});

test("패널 자리: 저장하면 { channelId, messageId }, messageId 가 null 이면 비운다", async () => {
  assert.equal(await settings.getPanel("g1"), null);
  await settings.setPanel("g1", "c1", "m1");
  fresh();
  assert.deepEqual(await settings.getPanel("g1"), { channelId: "c1", messageId: "m1" });
  await settings.setPanel("g1", "c1", null);
  assert.equal(await settings.getPanel("g1"), null);
  fresh();
  assert.equal(await settings.getPanel("g1"), null);
});

test("재생목록 한 번에 넣는 곡 수: 범위와 기본값, 저장, null 로 되돌리기", async () => {
  const limits = settings.playlistAddLimits();
  assert.equal(limits.min, 1);
  assert.equal(limits.default, config.bot.playlistAddDefault);
  assert.equal(limits.max, config.bot.maxQueueSize > 0 ? Math.min(1000, config.bot.maxQueueSize) : 1000);

  assert.equal(await settings.getPlaylistAddMax("g1"), null);
  await settings.setPlaylistAddMax("g1", 7);
  fresh();
  assert.equal(await settings.getPlaylistAddMax("g1"), 7);
  assert.equal(settings.resolvePlaylistAddMax("g1"), 7);
  await settings.setPlaylistAddMax("g1", null);
  fresh();
  assert.equal(settings.resolvePlaylistAddMax("g1"), Math.max(1, Math.min(limits.max, limits.default)), "미설정이면 기본값");
});

test("재생목록 곡 수는 읽을 때마다 범위로 자른다(저장 뒤 대기열 상한이 줄 수 있다)", async () => {
  const saved = config.bot.maxQueueSize;
  await settings.setPlaylistAddMax("g1", 500);
  try {
    config.bot.maxQueueSize = 50;
    assert.equal(settings.resolvePlaylistAddMax("g1"), 50);
    config.bot.maxQueueSize = 0; // 상한 없음 → 1000 이 위쪽 끝
    assert.equal(settings.resolvePlaylistAddMax("g1"), 500);
  } finally {
    config.bot.maxQueueSize = saved;
  }
});

test("재생목록 곡 수: DB 를 열기 전에는 읽지 않고 기본값", () => {
  audioCache.close();
  try {
    const { min, max, default: d } = settings.playlistAddLimits();
    assert.equal(settings.resolvePlaylistAddMax("g-unopened"), Math.max(min, Math.min(max, d)));
  } finally {
    audioCache.initialize(path.join(TMP, "cache.db"));
  }
  // 열기 전의 기본값을 담아 두지 않았다. 담아 뒀으면 연 뒤에 적은 값이 안 보인다
  guildTable.setPlaylistAddMax("g-unopened", 7);
  assert.equal(settings.resolvePlaylistAddMax("g-unopened"), 7);
});

test("SponsorBlock: 부분 갱신. 준 칸만 바꾸고 null 은 상속으로 되돌린다", async () => {
  assert.deepEqual(await settings.getSponsorBlock("g1"), { enabled: null, categories: null });
  await settings.setSponsorBlock("g1", { enabled: false });
  await settings.setSponsorBlock("g1", { categories: ["intro"] });
  fresh();
  assert.deepEqual(await settings.getSponsorBlock("g1"), { enabled: false, categories: ["intro"] });
  await settings.setSponsorBlock("g1", { enabled: null });
  fresh();
  assert.deepEqual(await settings.getSponsorBlock("g1"), { enabled: null, categories: ["intro"] });
});

test("SponsorBlock 유효값: 전역이 꺼져 있으면 서버 설정과 무관하게 끔. 켜져 있으면 서버값 ?? 기본", async () => {
  const saved = { ...config.sponsorblock };
  try {
    config.sponsorblock.enabled = true;
    config.sponsorblock.categories = ["sponsor", "intro"];
    assert.deepEqual(settings.resolveSponsorBlock("g1"), { enabled: true, categories: ["sponsor", "intro"] });
    await settings.setSponsorBlock("g1", { enabled: false, categories: ["outro"] });
    assert.deepEqual(settings.resolveSponsorBlock("g1"), { enabled: false, categories: ["outro"] });

    config.sponsorblock.enabled = false;
    assert.deepEqual(settings.resolveSponsorBlock("g1"), { enabled: false, categories: [] });
  } finally {
    Object.assign(config.sponsorblock, saved);
  }
});

test("읽은 값은 메모리에 남아 DB 를 다시 안 읽는다", async () => {
  await settings.setBotChannel("g1", "c1");
  await whenDbDown(async () => {
    assert.equal(await settings.getBotChannel("g1"), "c1");
  });
});

test("DB 가 실패하면 쓰기는 false, 읽기는 비어 있는 값(null · 빈 배열 · 상속)", async () => {
  assert.equal(await whenDbDown(() => settings.setBotChannel("g1", "c1")), false);
  assert.equal(await whenDbDown(() => settings.setDjRoles("g1", ["r"])), false);
  assert.equal(await whenDbDown(() => settings.setPlaylistAddMax("g1", 3)), false);
  assert.equal(await whenDbDown(() => settings.setSponsorBlock("g1", { enabled: true })), false);

  fresh();
  assert.equal(await whenDbDown(() => settings.getBotChannel("g2")), null);
  assert.deepEqual(await whenDbDown(() => settings.getDjRoles("g2")), []);
  assert.equal(await whenDbDown(() => settings.getPanel("g2")), null);
  assert.equal(await whenDbDown(() => settings.getPlaylistAddMax("g2")), null);
  assert.deepEqual(await whenDbDown(() => settings.getSponsorBlock("g2")), { enabled: null, categories: null });
  await assert.doesNotReject(() => whenDbDown(() => settings.clearBotChannel("g2")), "지우기는 실패를 삼킨다");
  await assert.doesNotReject(() => whenDbDown(() => settings.setPanel("g2", "c", "m")), "패널 자리 저장도 실패를 삼킨다");
});

test("실패한 읽기의 빈 값도 메모리에 남는다(DB 가 돌아와도 다시 안 읽는다)", async () => {
  await settings.setBotChannel("g3", "c3");
  fresh();
  await whenDbDown(() => settings.getBotChannel("g3"));
  assert.equal(await settings.getBotChannel("g3"), null);
});

// ── 표(guildTable)를 직접: 메모리 캐시 없이 한 칸씩 ─────────────

// ── guild_settings: DJ 역할 라운드트립 ───────────────────────

test("DJ 역할: 복수 저장/조회/해제", () => {
  guildTable.setDjRoles("g1", ["a", "b", "c"]);
  assert.deepEqual(guildTable.getDjRoles("g1"), ["a", "b", "c"]);

  guildTable.setDjRoles("g1", ["a"]);
  assert.deepEqual(guildTable.getDjRoles("g1"), ["a"], "덮어쓰기");

  guildTable.clearDjRoles("g1");
  assert.deepEqual(guildTable.getDjRoles("g1"), []);
});

test("DJ 역할: 빈 배열 저장 = 미설정(NULL)과 동일", () => {
  guildTable.setDjRoles("g2", []);
  assert.deepEqual(guildTable.getDjRoles("g2"), []);
  const raw = storeDb.get().prepare("SELECT dj_role_ids FROM guild_settings WHERE guild_id = 'g2'").get();
  assert.equal(raw.dj_role_ids, null);
});

test("DJ 역할: 손상된 JSON은 빈 배열로 폴백 (기동 불능 방지)", () => {
  storeDb.get().prepare("INSERT INTO guild_settings (guild_id, dj_role_ids, updated_at) VALUES ('g3', 'not-json', 0)").run();
  assert.deepEqual(guildTable.getDjRoles("g3"), []);
});

test("DJ 역할: 미지정 서버는 빈 배열", () => {
  assert.deepEqual(guildTable.getDjRoles("no-such-guild"), []);
});

// ── guild_settings: 봇 채널 ──────────────────────────────────

test("봇 채널: 저장/조회/해제 — DJ 설정과 같은 행에서 서로 무손상", () => {
  guildTable.setDjRoles("g4", ["r1"]);
  guildTable.setBotChannel("g4", "ch4");
  assert.equal(guildTable.getBotChannel("g4"), "ch4");
  assert.deepEqual(guildTable.getDjRoles("g4"), ["r1"]);

  guildTable.clearBotChannel("g4");
  assert.equal(guildTable.getBotChannel("g4"), null);
  assert.deepEqual(guildTable.getDjRoles("g4"), ["r1"], "채널 해제가 DJ 설정을 지우지 않음");
});
