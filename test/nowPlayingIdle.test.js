"use strict";

// 전용 채널의 패널 — 끝난 패널 자리를 재생 화면으로 고쳐 쓰고, 묻히면 맨 아래로, 음성에서 나가면 문구를 고친다.
// 전용 채널이 있으면 패널은 늘 그 채널에 둔다.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const GuildSettingsManager = require("../src/store/guildSettings");

const BOT = "bot-chan";
let botChannelId;
let original;
beforeEach(() => {
  botChannelId = BOT;
  original = GuildSettingsManager.getBotChannel;
  GuildSettingsManager.getBotChannel = async () => botChannelId;
});
afterEach(() => {
  GuildSettingsManager.getBotChannel = original;
});

function makeChannel(id, calls) {
  return {
    id,
    send: async (payload) => {
      const message = { id: `plain-${calls.sent.length}` };
      calls.sent.push({ channel: id, payload, id: message.id });
      return message;
    },
    messages: { cache: new Collection(), delete: async (messageId) => calls.deleted.push(`${id}:${messageId}`) },
  };
}

function setup({ record = null } = {}) {
  const calls = { sent: [], edited: [], deleted: [] };
  let next = 500;
  const channels = new Collection([
    [BOT, makeChannel(BOT, calls)],
    ["general", makeChannel("general", calls)],
  ]);
  const guild = { id: "g1", channels: { cache: channels } };
  const players = new Map();
  const mem = new MusicEmbedManager({ players, guilds: { cache: new Collection([["g1", guild]]) }, user: { username: "bot", displayName: "bot", displayAvatarURL: () => "https://example.org/a.png" } });
  mem.getOrCreateWebhook = async (channel) => ({
    async send(payload) {
      const id = String(next++);
      calls.sent.push({ channel: channel.id, payload, id });
      return { id, channel_id: channel.id };
    },
    async editMessage(id, payload) {
      if (calls.editError) throw calls.editError;
      calls.edited.push({ channel: channel.id, id, payload });
      return { id };
    },
    async deleteMessage(id) {
      calls.deleted.push(`${channel.id}:${id}`);
    },
  });
  const records = new Map(record ? [["g1", record]] : []);
  mem.panel.store = { getPanel: async (g) => records.get(g) ?? null, setPanel: async (g, channelId, messageId) => records.set(g, messageId ? { channelId, messageId } : null) };
  return { mem, guild, channels, calls, records, players };
}

function makePlayer(guild, textChannel, over = {}) {
  return {
    guild,
    textChannel,
    sessionId: "s1",
    requesterId: "u1",
    queue: [],
    previousTracks: [],
    loop: "off",
    paused: false,
    getCurrentTime: () => 0,
    currentTrack: { title: "곡", url: "https://example.org/a", duration: 100, platform: "youtube", thumbnail: "https://example.org/t.jpg" },
    nowPlayingMessage: null,
    nowPlayingWebhook: null,
    ...over,
  };
}

const textOf = (payload) => JSON.stringify(payload.components.map((c) => (typeof c.toJSON === "function" ? c.toJSON() : c)));
const bury = (channel, now) => channel.messages.cache.set("950", { id: "950", createdTimestamp: now - 60_000 });

async function play(mem, player) {
  try {
    await mem.createNewMusicEmbed(player, player.currentTrack, { id: "u1" });
  } finally {
    mem.stopProgressUpdate("g1");
  }
}

test("전용 채널: 끝난 패널이 맨 아래면 그 자리를 재생 화면으로 고친다 — 새로 올리지 않는다", async () => {
  const { mem, guild, channels, calls, records } = setup({ record: { channelId: BOT, messageId: "900" } });
  const player = makePlayer(guild, channels.get(BOT));

  await play(mem, player);

  assert.equal(calls.sent.length, 0);
  assert.equal(calls.edited.length, 1);
  assert.equal(calls.edited[0].id, "900");
  assert.deepEqual(calls.edited[0].payload.attachments, [], "종료 모양의 투명 썸네일 첨부를 뗀다");
  assert.match(textOf(calls.edited[0].payload), /현재 재생 중/);
  assert.equal(player.nowPlayingMessage.id, "900");
  assert.deepEqual(records.get("g1"), { channelId: BOT, messageId: "900" });
});

test("전용 채널: 끝난 패널이 묻혀 있으면 맨 아래에 새로 올리고 옛 패널을 지운다", async () => {
  const { mem, guild, channels, calls, records } = setup({ record: { channelId: BOT, messageId: "900" } });
  bury(channels.get(BOT), Date.now());

  await play(mem, makePlayer(guild, channels.get(BOT)));

  assert.equal(calls.edited.length, 0);
  assert.equal(calls.sent.length, 1);
  assert.ok(calls.deleted.includes(`${BOT}:900`));
  assert.equal(records.get("g1").messageId, calls.sent[0].id);
});

test("전용 채널이 있으면 다른 채널에서 틀어도 패널은 전용 채널에 — 없으면 요청한 채널", async () => {
  const withBot = setup();
  await play(withBot.mem, makePlayer(withBot.guild, withBot.channels.get("general")));
  assert.equal(withBot.calls.sent[0].channel, BOT);

  botChannelId = null;
  const noBot = setup({ record: { channelId: "general", messageId: "800" } });
  await play(noBot.mem, makePlayer(noBot.guild, noBot.channels.get("general")));
  assert.equal(noBot.calls.sent[0].channel, "general");
  assert.equal(noBot.calls.edited.length, 0, "전용 채널이 아니면 옛 패널을 고쳐 쓰지 않는다");
  assert.ok(noBot.calls.deleted.includes("general:800"));
});

test("살아 있는 패널이 없을 때 끝나면 기록된 패널의 문구만 고친다 — 종료 메시지는 없다", async () => {
  const { mem, guild, channels, calls } = setup({ record: { channelId: BOT, messageId: "900" } });
  const player = makePlayer(guild, channels.get("general"), { currentTrack: null });

  await mem.handlePlaybackEnd(player, { reason: "disconnected" });

  assert.equal(calls.edited.length, 1);
  assert.equal(calls.edited[0].id, "900");
  assert.match(textOf(calls.edited[0].payload), /쉬는 중이에요.*곡을 입력하면/);
  assert.equal(calls.sent.length, 0);
});

test("끝난 패널이 묻히면 기억해 둔 문구로 맨 아래에 다시 올린다", async () => {
  const { mem, guild, channels, calls, records, players } = setup({ record: { channelId: BOT, messageId: "900" } });
  const now = Date.now();
  mem.idleViews.set("g1", { reason: "leave", leavesAt: null });

  await mem.repinIdlePanel(guild, BOT, now);
  assert.equal(calls.sent.length, 0, "묻히지 않았으면 그대로");

  bury(channels.get(BOT), now);
  await mem.repinIdlePanel(guild, "general", now);
  assert.equal(calls.sent.length, 0, "전용 채널이 아닌 곳의 메시지는 상관없다");

  players.set("g1", { currentTrack: {}, nowPlayingMessage: { id: "1" } });
  await mem.repinIdlePanel(guild, BOT, now);
  assert.equal(calls.sent.length, 0, "재생 중이면 5초 갱신이 맡는다");
  players.clear();

  await mem.repinIdlePanel(guild, BOT, now);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].channel, BOT);
  assert.match(textOf(calls.sent[0].payload), /듣고 있던 곡이 있어요/);
  assert.equal(calls.sent[0].payload.files[0].name, "blank.png");
  assert.ok(calls.deleted.includes(`${BOT}:900`));
  assert.equal(records.get("g1").messageId, calls.sent[0].id);
});

test("전용 채널이 있는 서버에서 다른 채널로 틀고 끝나도 종료 메시지는 요청한 채널에 가지 않는다", async () => {
  const { mem, guild, channels, calls } = setup({ record: { channelId: BOT, messageId: "900" } });
  const player = makePlayer(guild, channels.get("general"));

  await play(mem, player); // 전용 채널의 끝난 패널을 고쳐 쓴다
  await mem.handlePlaybackEnd(player, { reason: "queue-end" });

  assert.equal(calls.edited.at(-1).id, "900", "패널은 전용 채널에서 종료 모양으로");
  assert.equal(calls.sent.filter((s) => s.channel === "general").length, 0);
});

test("기동: 전용 채널에 남은 패널은 음성 밖 문구로 고친다 — 새로 올리지 않는다", async () => {
  const { mem, calls } = setup({ record: { channelId: BOT, messageId: "900" } });
  await mem.restorePanels();
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.edited.length, 1);
  assert.match(textOf(calls.edited[0].payload), /쉬는 중이에요.*곡을 입력하면/);
});

test("기동: 전용 채널 패널이 없거나 지워졌으면 새로 올린다", async () => {
  const fresh = setup();
  await fresh.mem.restorePanels();
  assert.equal(fresh.calls.sent.length, 1);
  assert.equal(fresh.calls.sent[0].channel, BOT);
  assert.equal(fresh.records.get("g1").messageId, fresh.calls.sent[0].id);

  const gone = setup({ record: { channelId: BOT, messageId: "900" } });
  gone.calls.editError = Object.assign(new Error("Unknown Message"), { code: 10008 });
  await gone.mem.restorePanels();
  assert.equal(gone.calls.sent.length, 1);
  assert.equal(gone.records.get("g1").messageId, gone.calls.sent[0].id);
});

test("기동: 세션을 복원해 패널을 올린 서버는 건너뛰고, 전용 채널이 없으면 기록된 패널만 고친다", async () => {
  const restored = setup({ record: { channelId: BOT, messageId: "900" } });
  restored.players.set("g1", { nowPlayingMessage: { id: "900" } });
  await restored.mem.restorePanels();
  assert.equal(restored.calls.edited.length + restored.calls.sent.length, 0);

  botChannelId = null;
  const plain = setup({ record: { channelId: "general", messageId: "800" } });
  await plain.mem.restorePanels();
  assert.equal(plain.calls.sent.length, 0);
  assert.equal(plain.calls.edited[0].id, "800");
  assert.match(textOf(plain.calls.edited[0].payload), /\/play/);
});

test("전용 채널을 정하면 끝난 패널을 그 채널에 올리고 옛 패널을 지운다 — 풀면 지운다", async () => {
  const { mem, guild, calls, records } = setup({ record: { channelId: "general", messageId: "800" } });
  await mem.onBotChannelChanged(guild);
  assert.equal(calls.sent[0].channel, BOT);
  assert.ok(calls.deleted.includes("general:800"));

  botChannelId = null;
  const current = records.get("g1").messageId;
  await mem.onBotChannelChanged(guild);
  assert.ok(calls.deleted.includes(`${BOT}:${current}`));
  assert.equal(records.get("g1"), null);
});

test("재생 중에 전용 채널을 정하면 재생 패널을 옮기고, 풀면 그대로 둔다", async () => {
  const { mem, guild, channels, calls, players } = setup({ record: { channelId: "general", messageId: "800" } });
  const player = makePlayer(guild, channels.get("general"), { nowPlayingMessage: { id: "800", channel_id: "general" } });
  players.set("g1", player);

  await mem.onBotChannelChanged(guild);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].channel, BOT);
  assert.match(textOf(calls.sent[0].payload), /현재 재생 중/);
  assert.ok(calls.deleted.includes("general:800"));

  botChannelId = null;
  const deletedBefore = calls.deleted.length;
  await mem.onBotChannelChanged(guild);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.deleted.length, deletedBefore);
});

test("곡이 없을 때 /dashboard는 끝난 패널을 그 채널에 다시 올린다", async () => {
  const { mem, guild, channels, calls, records } = setup({ record: { channelId: BOT, messageId: "900" } });
  await mem.repostIdlePanel(guild, channels.get(BOT));
  assert.equal(calls.sent[0].channel, BOT);
  assert.match(textOf(calls.sent[0].payload), /곡을 입력하면/);
  assert.ok(calls.deleted.includes(`${BOT}:900`));
  assert.equal(records.get("g1").messageId, calls.sent[0].id);
});
