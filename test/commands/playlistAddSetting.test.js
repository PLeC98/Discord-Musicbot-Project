"use strict";

// 재생목록 한 번에 넣는 곡 수 — 서버 설정의 범위 계산과 /setplaylistlimit.
// 진짜 서버 설정을 임시 DB 로 쓴다.

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { openTempStore } = require("../helpers/tempStore");

const store = openTempStore("playlist-add-");
after(() => store.close());
const guildTable = require("../../src/store/guildSettings").table;
const stored = { get: (g) => guildTable.getPlaylistAddMax(g), set: (g, n) => guildTable.setPlaylistAddMax(g, n), has: (g) => guildTable.getPlaylistAddMax(g) !== null };

const config = require("../../config");
const GuildSettingsManager = require("../../src/store/guildSettings");
const command = require("../../commands/setplaylistlimit");

const G = "g1";
const savedQueueMax = config.bot.maxQueueSize;

beforeEach(() => {
  store.db().exec("DELETE FROM guild_settings");
  GuildSettingsManager.cache.clear();
  config.bot.maxQueueSize = savedQueueMax;
});

async function withQueueMax(max, fn) {
  config.bot.maxQueueSize = max;
  try {
    await fn();
  } finally {
    config.bot.maxQueueSize = savedQueueMax;
  }
}

test("범위: 위쪽 끝은 대기열 상한과 1000 중 작은 쪽, 상한이 꺼져 있으면 1000", () =>
  withQueueMax(250, async () => {
    assert.deepEqual(GuildSettingsManager.playlistAddLimits(), { min: 1, max: 250, default: config.bot.playlistAddDefault });
    config.bot.maxQueueSize = 0;
    assert.equal(GuildSettingsManager.playlistAddLimits().max, 1000);
    config.bot.maxQueueSize = 5000;
    assert.equal(GuildSettingsManager.playlistAddLimits().max, 1000);
  }));

test("실제 값: 미설정이면 기본값, 설정하면 그 값", async () => {
  assert.equal(GuildSettingsManager.resolvePlaylistAddMax(G), config.bot.playlistAddDefault);
  await GuildSettingsManager.setPlaylistAddMax(G, 120);
  assert.equal(GuildSettingsManager.resolvePlaylistAddMax(G), 120);
  await GuildSettingsManager.setPlaylistAddMax(G, null);
  assert.equal(GuildSettingsManager.resolvePlaylistAddMax(G), config.bot.playlistAddDefault);
});

test("실제 값: 저장 뒤 대기열 상한이 줄면 읽을 때 상한으로 자른다", async () => {
  stored.set(G, 200);
  await withQueueMax(100, async () => {
    assert.equal(GuildSettingsManager.resolvePlaylistAddMax(G), 100);
  });
});

// ── /setplaylistlimit ────────────────────────────────────────

function interaction({ count = null, action = null } = {}) {
  const replies = [];
  return {
    guild: { id: G },
    options: { getInteger: () => count, getString: () => action },
    reply: async (payload) => replies.push(payload),
    replies,
  };
}
const text = (payload) => payload.content ?? payload.embeds[0].data.description;

test("/setplaylistlimit: 값을 주면 저장", async () => {
  const i = interaction({ count: 30 });
  await command.execute(i);
  assert.equal(stored.get(G), 30);
  assert.match(text(i.replies[0]), /30곡/);
});

test("/setplaylistlimit: 값 없이 부르면 지금 값만 보여 준다 (기본값 표시)", async () => {
  const i = interaction();
  await command.execute(i);
  assert.equal(stored.has(G), false);
  assert.match(text(i.replies[0]), new RegExp(`${config.bot.playlistAddDefault}곡.*기본값`));
});

test("/setplaylistlimit: 대기열 상한을 넘으면 거부하고 저장하지 않는다", () =>
  withQueueMax(100, async () => {
    const i = interaction({ count: 150 });
    await command.execute(i);
    assert.equal(stored.has(G), false);
    assert.match(text(i.replies[0]), /1~100곡.*대기열 상한/);
  }));

test("/setplaylistlimit: reset은 기본값으로 되돌린다", async () => {
  stored.set(G, 80);
  const i = interaction({ action: "reset" });
  await command.execute(i);
  assert.equal(stored.get(G), null);
  assert.equal(GuildSettingsManager.resolvePlaylistAddMax(G), config.bot.playlistAddDefault);
});
