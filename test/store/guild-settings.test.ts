// src/store/guild-settings.ts: 서버별 설정(GuildSettingsManager)의 지금 동작을 고정한다.
//
// 서버 설정 표 위에 메모리 캐시를 얹은 층이다. 설정마다 읽기, 쓰기, 지우기, 메모리 캐시,
// DB 가 실패했을 때 돌려주는 값을 적어 둔다. 진짜 표를 임시 DB 로 쓴다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as stores from "../../src/store/stores.ts";
import { settingsDb } from "../../src/store/settings-db.ts";
import * as panelRecords from "../../src/store/panel-records.ts";
import { whenSettingsBroken } from "../helpers/temp-store.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import sink from "../../src/infra/log/sink.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "guild-settings-"));
const guildTable = (await import("../../src/store/guild-settings.ts")).table;
const audioCache = await import("../../src/store/audio-cache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();
const settings = await import("../../src/store/guild-settings.ts");
const config = (await import("../../src/config/index.ts")).default;

beforeEach(() => {
  settings.forgetCache();
  settingsDb.get().exec("DELETE FROM guild_settings;");
});

after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

// 메모리 캐시를 비우고 다시 읽는다. DB 에 실제로 남았는지 본다
const fresh = () => settings.forgetCache();

// 서버 설정 표가 망가진 동안(읽기, 쓰기가 SQLite 오류로 실패한다)
const whenDbDown = whenSettingsBroken;

test("전용 채널: 저장, 읽기, 지우기. 미설정은 null", async () => {
  assert.equal(await settings.getBotChannel("g1"), null);
  fresh();
  assert.deepEqual(await settings.setBotChannel("g1", "c1"), ["botChannelId"]);
  fresh();
  assert.equal(await settings.getBotChannel("g1"), "c1");
  await settings.clearBotChannel("g1");
  assert.equal(await settings.getBotChannel("g1"), null);
});

test("DJ 역할: 저장, 읽기, 지우기. 미설정은 빈 배열", async () => {
  assert.deepEqual(await settings.getDjRoles("g1"), []);
  fresh();
  await settings.setDjRoles("g1", ["r1", "r2"]);
  fresh();
  assert.deepEqual(await settings.getDjRoles("g1"), ["r1", "r2"]);
  await settings.clearDjRoles("g1");
  fresh();
  assert.deepEqual(await settings.getDjRoles("g1"), []);
});

test("패널 위치(실행 상태 DB): 저장하면 { channelId, messageId }, messageId 가 null 이면 비운다", async () => {
  assert.equal(await panelRecords.getPanel("g1"), null);
  await panelRecords.setPanel("g1", "c1", "m1");
  panelRecords._reset();
  assert.deepEqual(await panelRecords.getPanel("g1"), { channelId: "c1", messageId: "m1" });
  await panelRecords.setPanel("g1", "c1", null);
  assert.equal(await panelRecords.getPanel("g1"), null);
  panelRecords._reset();
  assert.equal(await panelRecords.getPanel("g1"), null);
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
  stores.close();
  try {
    const { min, max, default: d } = settings.playlistAddLimits();
    assert.equal(settings.resolvePlaylistAddMax("g-unopened"), Math.max(min, Math.min(max, d)));
  } finally {
    stores.open(TMP);
  }
  // 열기 전의 기본값을 담아 두지 않는다. 담아 두면 연 뒤에 적은 값이 안 보인다
  guildTable.setPlaylistAddMax("g-unopened", 7);
  assert.equal(settings.resolvePlaylistAddMax("g-unopened"), 7);
});

test("볼륨: 저장하면 새 플레이어가 그 값으로 시작하고, 기본 볼륨이면 문서에서 지운다. 미설정은 기본 볼륨", async () => {
  assert.equal(settings.resolveVolume("g1"), config.bot.defaultVolume);
  assert.deepEqual(await settings.saveVolume("g1", 30), ["volume"]);
  fresh();
  assert.equal(settings.resolveVolume("g1"), 30);
  await settings.saveVolume("g1", config.bot.defaultVolume);
  fresh();
  assert.equal(settings.resolveVolume("g1"), config.bot.defaultVolume);
  assert.equal(guildTable.getVolume("g1"), null, "기본값은 남기지 않는다");
});

test("SponsorBlock: 부분 갱신. 준 필드만 바꾸고 null 은 상속으로 되돌린다", async () => {
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

test("볼륨 정규화: 기본 끔, 켜고 끄기. 끄면 필드를 뺀다", async () => {
  assert.equal(settings.resolveNormalize("g1"), false);
  assert.deepEqual(await settings.setNormalize("g1", true), ["normalize"]);
  fresh();
  assert.equal(settings.resolveNormalize("g1"), true);
  await settings.setNormalize("g1", false);
  fresh();
  assert.equal(settings.resolveNormalize("g1"), false);
  assert.equal(guildTable.getNormalize("g1"), false);
});

test("볼륨 정규화: 프레임마다 읽으므로 읽기 실패는 끔으로 기억하고 오류 로그를 한 번만 남긴다. 저장하면 다시 그 값을 쓴다", async () => {
  const from = sink.buffer.length;
  try {
    await settings.setNormalize("g3", true);
    fresh();
    await whenDbDown(() => {
      for (let i = 0; i < 50; i++) assert.equal(settings.resolveNormalize("g3"), false);
    });
    assert.equal(sink.buffer.slice(from).filter((e) => e.text.startsWith("볼륨 정규화 설정 읽기 실패")).length, 1);
    assert.equal(settings.resolveNormalize("g3"), false, "DB 가 돌아와도 바꾸거나 초기화하기 전에는 기억한 끔");
    fresh();
    assert.equal(settings.resolveNormalize("g3"), true);
  } finally {
    await settings.setNormalize("g3", false);
  }
});

test("읽은 값은 메모리에 남아 DB 를 다시 안 읽는다", async () => {
  await settings.setBotChannel("g1", "c1");
  await whenDbDown(async () => {
    assert.equal(await settings.getBotChannel("g1"), "c1");
  });
});

test("DB 가 실패하면 쓰기는 던지고 캐시는 그대로, 읽기는 비어 있는 값(null, 빈 배열, 상속)", async () => {
  await settings.setBotChannel("g1", "c0");
  for (const write of [() => settings.setBotChannel("g1", "c1"), () => settings.clearBotChannel("g1"), () => settings.setDjRoles("g1", ["r"]), () => settings.clearDjRoles("g1"), () => settings.setPlaylistAddMax("g1", 3), () => settings.setSponsorBlock("g1", { enabled: true }), () => settings.setAgePlace("g1", "all"), () => settings.saveVolume("g1", 30), () => settings.setNormalize("g1", true)]) {
    await assert.rejects(() => whenDbDown(write));
  }
  assert.equal(await settings.getBotChannel("g1"), "c0", "실패한 쓰기는 캐시를 바꾸지 않는다");

  fresh();
  assert.equal(await whenDbDown(() => settings.getBotChannel("g2")), null);
  assert.deepEqual(await whenDbDown(() => settings.getDjRoles("g2")), []);
  assert.equal(await whenDbDown(() => settings.getPlaylistAddMax("g2")), null);
  assert.deepEqual(await whenDbDown(() => settings.getSponsorBlock("g2")), { enabled: null, categories: null });
});

test("실패한 읽기는 기억하지 않는다. DB 가 돌아오면 다시 읽는다", async () => {
  await settings.setBotChannel("g3", "c3");
  fresh();
  assert.equal(await whenDbDown(() => settings.getBotChannel("g3")), null);
  assert.equal(await settings.getBotChannel("g3"), "c3");
});

// 열기 전에 부른 것은 조립 순서가 틀린 것이다. 그 서버의 설정이 없다는 뜻이 아니다
test("DB 를 열기 전에 부르면 기본값으로 삼키지 않고 던진다", async () => {
  fresh();
  stores.close();
  try {
    for (const call of [() => settings.getBotChannel("g4"), () => settings.setBotChannel("g4", "c"), () => settings.getDjRoles("g4"), () => settings.clearDjRoles("g4"), () => settings.getSponsorBlock("g4")]) {
      await assert.rejects(call, (e) => codeOf(e) === "DB_NOT_OPEN");
    }
    assert.throws(
      () => settings.resolveSponsorBlock("g4"),
      (e) => codeOf(e) === "DB_NOT_OPEN",
    );
  } finally {
    stores.open(TMP);
  }
});

// ── 표(guildTable)를 직접: 메모리 캐시 없이 한 필드씩 ─────────────

// ── 서버 설정 문서: DJ 역할 라운드트립 ───────────────────────

test("DJ 역할: 복수 저장/조회/해제", () => {
  guildTable.setDjRoles("g1", ["a", "b", "c"]);
  assert.deepEqual(guildTable.getDjRoles("g1"), ["a", "b", "c"]);

  guildTable.setDjRoles("g1", ["a"]);
  assert.deepEqual(guildTable.getDjRoles("g1"), ["a"], "덮어쓰기");

  guildTable.clearDjRoles("g1");
  assert.deepEqual(guildTable.getDjRoles("g1"), []);
});

test("DJ 역할: 빈 배열 저장 = 미설정과 동일. 빈 문서가 되면 행을 삭제한다", () => {
  guildTable.setDjRoles("g2", ["r"]);
  guildTable.setDjRoles("g2", []);
  assert.deepEqual(guildTable.getDjRoles("g2"), []);
  const row = settingsDb.get().prepare("SELECT data_json FROM guild_settings WHERE guild_id = 'g2'").get();
  assert.equal(row, undefined);
});

test("손상된 문서는 정하지 않은 것으로 (기동 불능 방지)", () => {
  settingsDb.get().prepare("INSERT INTO guild_settings (guild_id, data_json) VALUES ('g3', 'not-json')").run();
  assert.deepEqual(guildTable.getDjRoles("g3"), []);
  assert.equal(guildTable.getBotChannel("g3"), null);
});

test("필드 하나의 모양이 틀려도 다른 필드는 읽는다", () => {
  settingsDb
    .get()
    .prepare("INSERT INTO guild_settings (guild_id, data_json) VALUES ('g5', ?)")
    .run(JSON.stringify({ djRoleIds: "r1", botChannelId: "c5", playlistAddMax: -3 }));
  const from = sink.buffer.length;
  assert.deepEqual(guildTable.getDjRoles("g5"), []);
  assert.equal(guildTable.getBotChannel("g5"), "c5");
  assert.equal(guildTable.getPlaylistAddMax("g5"), null);
  const warned = sink.buffer.slice(from).filter((e) => e.text.startsWith("서버 g5 설정의"));
  assert.deepEqual(
    warned.map((e) => e.text),
    ["서버 g5 설정의 djRoleIds, playlistAddMax 값 검증 실패(기본값 사용)"],
    "곡마다 읽어도 같은 문서는 한 번만 알린다",
  );
});

test("DJ 역할: 미지정 서버는 빈 배열", () => {
  assert.deepEqual(guildTable.getDjRoles("no-such-guild"), []);
});

// ── 서버 설정 문서: 봇 채널 ──────────────────────────────────

test("봇 채널: 저장/조회/해제. DJ 설정과 같은 문서에서 서로 무손상", () => {
  guildTable.setDjRoles("g4", ["r1"]);
  guildTable.setBotChannel("g4", "ch4");
  assert.equal(guildTable.getBotChannel("g4"), "ch4");
  assert.deepEqual(guildTable.getDjRoles("g4"), ["r1"]);

  guildTable.clearBotChannel("g4");
  assert.equal(guildTable.getBotChannel("g4"), null);
  assert.deepEqual(guildTable.getDjRoles("g4"), ["r1"], "채널 해제가 DJ 설정을 지우지 않음");
});

// ── 쓰기 한 곳(update) ──────────────────────────────────────

// 읽기는 되고 쓰기만 실패하게 한다. 한 번에 한 종류만 걸고 늘 지운다(남은 DELETE 막기는 뒤 시험을 막는다)
async function whenWriteFails<T>(kind: "INSERT" | "UPDATE" | "DELETE", fn: () => T | Promise<T>): Promise<T> {
  const db = settingsDb.get();
  db.exec(`CREATE TRIGGER block_write BEFORE ${kind} ON guild_settings BEGIN SELECT RAISE(ABORT, 'blocked'); END`);
  try {
    return await fn();
  } finally {
    db.exec("DROP TRIGGER block_write");
  }
}

test("update: 여러 필드를 한 번에 쓰고 바뀐 필드만 돌려준다. 같은 값이면 바뀐 것이 없다(역할은 순서와 중복을 보지 않는다)", () => {
  const first = settings.update("u1", { botChannelId: "c1", djRoleIds: ["r1", "r2"], playlistAddMax: 30 });
  assert.equal(first.ok, true);
  assert.deepEqual(first.ok && first.changed, ["botChannelId", "djRoleIds", "playlistAddMax"]);
  const again = settings.update("u1", { botChannelId: "c1", djRoleIds: ["r2", "r1", "r1"] });
  assert.deepEqual(again.ok && again.changed, []);
  assert.deepEqual(guildTable.getDjRoles("u1"), ["r1", "r2"], "바뀐 것이 없으면 쓰지 않는다");
});

test("update: 기본값은 문서에서 빼고, 마지막 필드를 지우면 행을 지운다", () => {
  settings.update("u2", { agePlace: "all", normalize: true });
  settings.update("u2", { agePlace: "channel", normalize: false });
  assert.equal(settingsDb.get().prepare("SELECT COUNT(*) FROM guild_settings WHERE guild_id = 'u2'").pluck().get(), 0);
});

test("update: SponsorBlock 은 준 하위 키만 바꾸고 나머지는 행의 값이다(캐시가 낡아도). 구간의 [] 는 남고 null 과 다르다", async () => {
  settings.update("u3", { sponsorBlock: { enabled: true, categories: ["intro"] } });
  assert.deepEqual(await settings.getSponsorBlock("u3"), { enabled: true, categories: ["intro"] });
  guildTable.setGuildSponsorBlock("u3", { enabled: true, categories: ["outro"] }); // 캐시를 거치지 않는 쓰기라 캐시는 intro 로 낡았다
  settings.update("u3", { sponsorBlock: { enabled: false } });
  assert.deepEqual(guildTable.getGuildSponsorBlock("u3"), { enabled: false, categories: ["outro"] });
  const empty = settings.update("u3", { sponsorBlock: { categories: [] } });
  assert.deepEqual(empty.ok && empty.changed, ["sponsorBlock"]);
  assert.deepEqual(guildTable.getGuildSponsorBlock("u3"), { enabled: false, categories: [] });
  settings.update("u3", { sponsorBlock: { categories: null } });
  assert.deepEqual(guildTable.getGuildSponsorBlock("u3"), { enabled: false, categories: null });
});

test("update: check 가 키를 돌려주면 아무것도 쓰지 않고 그때의 문서를 돌려준다", () => {
  settings.update("u4", { botChannelId: "c1" });
  const result = settings.update("u4", { botChannelId: "c2", playlistAddMax: 9 }, (doc) => (doc.botChannelId === "c1" ? ["botChannelId"] : []));
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.conflicts, ["botChannelId"]);
  assert.equal(result.doc.botChannelId, "c1");
  assert.equal(guildTable.getPlaylistAddMax("u4"), null);
});

test("update: 읽기는 되고 쓰기가 실패하면(넣기, 고치기, 지우기) 아무것도 바뀌지 않고 캐시도 그대로다", async () => {
  await assert.rejects(() => whenWriteFails("INSERT", () => settings.update("u5", { botChannelId: "c1", playlistAddMax: 5 })));
  assert.equal(guildTable.getBotChannel("u5"), null);
  settings.update("u5", { botChannelId: "c1" });
  assert.equal(await settings.getBotChannel("u5"), "c1");
  await assert.rejects(() => whenWriteFails("UPDATE", () => settings.update("u5", { botChannelId: "c2", playlistAddMax: 5 })));
  assert.equal(guildTable.getBotChannel("u5"), "c1");
  assert.equal(guildTable.getPlaylistAddMax("u5"), null, "한 트랜잭션이라 앞 필드도 남지 않는다");
  assert.equal(await settings.getBotChannel("u5"), "c1");
  await assert.rejects(() => whenWriteFails("DELETE", () => settings.clearBotChannel("u5")));
  assert.equal(guildTable.getBotChannel("u5"), "c1");
});

test("update: 바뀐 것이 없는 쓰기도 패치에 든 필드의 캐시를 행의 값으로 고친다(읽기 실패로 남은 끔)", async () => {
  settings.update("u6", { normalize: true });
  fresh();
  await whenDbDown(() => assert.equal(settings.resolveNormalize("u6"), false));
  assert.equal(settings.resolveNormalize("u6"), false, "읽기 실패로 기억한 끔");
  const result = settings.update("u6", { normalize: true });
  assert.deepEqual(result.ok && result.changed, []);
  assert.equal(settings.resolveNormalize("u6"), true);
});

test("onChanged: 커밋 뒤 바뀐 필드로 한 번(볼륨 포함). 바뀐 것이 없거나 실패하면 알리지 않고, 듣는 쪽이 던져도 저장은 된다", async () => {
  const heard: Array<[string, string[]]> = [];
  const off = settings.onChanged((guildId, fields) => heard.push([guildId, fields]));
  const offThrow = settings.onChanged(() => {
    throw new Error("듣는 쪽 오류");
  });
  try {
    settings.update("u7", { volume: 30, djRoleIds: ["r1"] });
    settings.update("u7", { volume: 30 });
    await assert.rejects(() => whenWriteFails("UPDATE", () => settings.update("u7", { volume: 40 })));
    assert.deepEqual(heard, [["u7", ["djRoleIds", "volume"]]]);
    assert.equal(guildTable.getVolume("u7"), 30);
  } finally {
    off();
    offThrow();
  }
});

test("removeAll: 모든 서버의 설정을 지우고 캐시를 비우며, 설정이 있던 서버마다 그 필드를 알린다", async () => {
  settings.update("u8", { botChannelId: "c8" });
  settings.update("u9", { normalize: true, volume: 20 });
  assert.equal(await settings.getBotChannel("u8"), "c8");
  const heard: Array<[string, string[]]> = [];
  const off = settings.onChanged((guildId, fields) => heard.push([guildId, [...fields].sort()]));
  try {
    settings.removeAll();
  } finally {
    off();
  }
  assert.equal(settings.guildCount(), 0);
  assert.equal(await settings.getBotChannel("u8"), null);
  assert.deepEqual(heard.sort(), [
    ["u8", ["botChannelId"]],
    ["u9", ["normalize", "volume"]],
  ]);
});
