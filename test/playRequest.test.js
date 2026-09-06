"use strict";

// src/playRequest.js — 곡 추가 경로의 단일 코어.
//
// 회귀 대상: 슬래시 명령/전용 채널/검색 선택은 handleMusicData를, 대시보드는 addTrack을 타서
// 코어가 둘로 갈려 있었다. 같은 버그를 두 번 고쳐야 했고 요청자 모양도 서로 달랐다.

const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");

// ── 모킹 (playRequest보다 먼저 — 실 SQLite/네트워크 미접촉) ──────────────
let mockBotChannelId = null;
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "GuildSettingsManager.js"));
require.cache[gsmPath] = { id: gsmPath, filename: gsmPath, loaded: true, exports: { getBotChannel: async () => mockBotChannelId } };

let mockResolve = null;
const resolverCalls = [];
const trPath = require.resolve(path.join(__dirname, "..", "src", "TrackResolver.js"));
require.cache[trPath] = {
  id: trPath,
  filename: trPath,
  loaded: true,
  exports: {
    async resolveQuery(query, guildId, context) {
      resolverCalls.push({ query, guildId, context });
      return mockResolve(query);
    },
  },
};

const { requestPlayback, toRequester, ensurePlayer } = require("../src/playRequest");

// ── 하네스 ───────────────────────────────────────────────────
const GUILD_ID = "g1";

function makeChannel(id) {
  return { id, send: async () => ({ delete: async () => {} }) };
}

function makeGuild({ botVoice = null, channels = [] } = {}) {
  const cache = new Map(channels.map((c) => [c.id, c]));
  return { id: GUILD_ID, channels: { cache }, members: { me: { voice: { channel: botVoice } } } };
}

function makeClient({ handleMusicData } = {}) {
  const embedCalls = [];
  return {
    embedCalls,
    players: new Map(),
    musicEmbedManager: {
      async handleMusicData(guildId, trackData, requester, responder) {
        embedCalls.push({ guildId, trackData, requester, responder });
        return handleMusicData ? handleMusicData(trackData) : { success: true };
      },
    },
  };
}

function track(title) {
  return { title, url: `https://x/${title}`, platform: "youtube" };
}

function ok(...titles) {
  return { success: true, isPlaylist: titles.length > 1, tracks: titles.map(track) };
}

// ── toRequester ──────────────────────────────────────────────

test("toRequester: GuildMember의 username은 user.username에서 온다 (GuildMember엔 username이 없다)", () => {
  const member = { id: "u1", user: { username: "carl", tag: "carl#0" }, displayName: "칼" };
  assert.deepEqual(toRequester(member), { id: "u1", username: "carl", tag: "carl#0" });
});

test("toRequester: 대시보드 세션 사용자와 세션 복구 스텁도 같은 모양이 된다", () => {
  assert.deepEqual(toRequester({ id: "u2", username: "web" }), { id: "u2", username: "web", tag: null });
  assert.deepEqual(toRequester({ id: "u3", tag: "old#1" }), { id: "u3", username: null, tag: "old#1" });
});

test("toRequester: username이 없으면 displayName으로 떨어진다", () => {
  assert.equal(toRequester({ id: "u4", displayName: "닉네임" }).username, "닉네임");
});

test("toRequester: null/문자열에 던지지 않는다", () => {
  assert.equal(toRequester(null), null);
  assert.equal(toRequester(undefined), null);
  assert.deepEqual(toRequester("자동재생"), { id: null, username: "자동재생", tag: "자동재생" });
});

// ── ensurePlayer ─────────────────────────────────────────────

test("ensurePlayer: 없으면 만들고 맵에 넣는다", () => {
  const client = makeClient();
  const guild = makeGuild();
  const channel = makeChannel("t1");
  const voice = { id: "v1" };

  const player = ensurePlayer(client, { guild, textChannel: channel, voiceChannel: voice });
  assert.equal(client.players.get(GUILD_ID), player);
  assert.equal(player.textChannel, channel);
  assert.equal(player.voiceChannel, voice);
});

test("ensurePlayer: 있으면 재사용한다 — 큐가 사라지면 안 된다", () => {
  const client = makeClient();
  const guild = makeGuild();
  const existing = { queue: [track("a")], textChannel: makeChannel("old"), voiceChannel: { id: "v0" } };
  client.players.set(GUILD_ID, existing);

  const player = ensurePlayer(client, { guild, textChannel: makeChannel("new"), voiceChannel: { id: "v1" } });
  assert.equal(player, existing);
  assert.equal(player.queue.length, 1);
});

test("ensurePlayer: 봇이 재생 중이면 voiceChannel을 갱신하지 않는다 (다른 채널 참조 오염 방지)", () => {
  const client = makeClient();
  const botVoice = { id: "botVC" };
  const guild = makeGuild({ botVoice });
  const existing = { voiceChannel: botVoice, textChannel: null };
  client.players.set(GUILD_ID, existing);

  ensurePlayer(client, { guild, textChannel: makeChannel("t"), voiceChannel: { id: "요청자VC" } });
  assert.equal(existing.voiceChannel, botVoice);
});

test("ensurePlayer: 봇이 유휴면 요청자 채널로 갱신한다", () => {
  const client = makeClient();
  const guild = makeGuild({ botVoice: null });
  const existing = { voiceChannel: null, textChannel: null };
  client.players.set(GUILD_ID, existing);

  const requesterVC = { id: "v9" };
  ensurePlayer(client, { guild, textChannel: null, voiceChannel: requesterVC });
  assert.equal(existing.voiceChannel, requesterVC);
});

test("ensurePlayer: textChannel을 null로 덮어쓰지 않는다 (대시보드가 기존 채널을 지우면 안 됨)", () => {
  const client = makeClient();
  const guild = makeGuild();
  const kept = makeChannel("keep");
  const existing = { textChannel: kept, voiceChannel: null };
  client.players.set(GUILD_ID, existing);

  ensurePlayer(client, { guild, textChannel: null, voiceChannel: null });
  assert.equal(existing.textChannel, kept);
});

// ── requestPlayback ──────────────────────────────────────────

function baseArgs(client, guild, extra = {}) {
  client.players.set(GUILD_ID, { textChannel: makeChannel("t"), voiceChannel: null, queue: [] });
  return { guild, requester: { id: "u1", user: { username: "carl" } }, ...extra };
}

test("query 경로: 해석 결과를 코어에 그대로 넘긴다", async () => {
  mockResolve = () => ok("곡A");
  const client = makeClient();
  const guild = makeGuild();

  const result = await requestPlayback(client, baseArgs(client, guild, { query: "곡A", source: "/play" }));

  assert.equal(result.success, true);
  assert.deepEqual(
    client.embedCalls[0].trackData.tracks.map((t) => t.title),
    ["곡A"],
  );
  assert.equal(resolverCalls.at(-1).query, "곡A");
  assert.equal(resolverCalls.at(-1).context, "/play.resolveQuery");
});

test("tracks 경로: 이미 해석된 트랙은 해석기를 거치지 않는다 (검색 선택)", async () => {
  const before = resolverCalls.length;
  const client = makeClient();
  const guild = makeGuild();

  const result = await requestPlayback(client, baseArgs(client, guild, { tracks: [track("선택곡")] }));

  assert.equal(result.success, true);
  assert.equal(resolverCalls.length, before, "해석기 미호출");
  assert.equal(client.embedCalls[0].trackData.tracks[0].title, "선택곡");
});

test("두 경로가 같은 결과 모양을 낸다", async () => {
  mockResolve = () => ok("곡A");
  const c1 = makeClient();
  const c2 = makeClient();
  const g = makeGuild();

  const a = await requestPlayback(c1, baseArgs(c1, g, { query: "곡A" }));
  const b = await requestPlayback(c2, baseArgs(c2, g, { tracks: [track("곡A")] }));

  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
});

test("single: 재생목록이어도 첫 곡만 넣는다 (대시보드 '한 곡만')", async () => {
  mockResolve = () => ok("1번", "2번", "3번");
  const client = makeClient();
  const guild = makeGuild();

  await requestPlayback(client, baseArgs(client, guild, { query: "리스트", single: true }));

  const { trackData } = client.embedCalls[0];
  assert.deepEqual(
    trackData.tracks.map((t) => t.title),
    ["1번"],
  );
  assert.equal(trackData.isPlaylist, false);
});

test("single이 아니면 재생목록 전체가 간다", async () => {
  mockResolve = () => ok("1번", "2번", "3번");
  const client = makeClient();
  const guild = makeGuild();

  await requestPlayback(client, baseArgs(client, guild, { query: "리스트" }));
  assert.equal(client.embedCalls[0].trackData.tracks.length, 3);
  assert.equal(client.embedCalls[0].trackData.isPlaylist, true);
});

test("insertFirst가 코어로 전달된다", async () => {
  mockResolve = () => ok("곡A");
  const client = makeClient();
  const guild = makeGuild();

  await requestPlayback(client, baseArgs(client, guild, { query: "곡A", insertFirst: true }));
  assert.equal(client.embedCalls[0].trackData.insertFirst, true);
});

test("해석 실패는 렌더링 없이 그대로 전파된다", async () => {
  mockResolve = () => ({ success: false, message: "❌ 결과를 찾을 수 없습니다!" });
  const client = makeClient();
  const guild = makeGuild();

  const result = await requestPlayback(client, baseArgs(client, guild, { query: "없는곡" }));

  assert.equal(result.success, false);
  assert.equal(result.message, "❌ 결과를 찾을 수 없습니다!");
  assert.equal(client.embedCalls.length, 0, "실패 시 코어를 부르지 않는다");
});

test("요청자는 정규화된 모양으로 코어에 들어간다 (대시보드 username undefined 회귀)", async () => {
  mockResolve = () => ok("곡A");
  const client = makeClient();
  const guild = makeGuild();

  await requestPlayback(client, baseArgs(client, guild, { query: "곡A" }));
  assert.deepEqual(client.embedCalls[0].requester, { id: "u1", username: "carl", tag: null });
});

test("responder를 주지 않으면 무동작 어댑터가 간다 (대시보드)", async () => {
  mockResolve = () => ok("곡A");
  const client = makeClient();
  const guild = makeGuild();

  await requestPlayback(client, baseArgs(client, guild, { query: "곡A" }));
  const { responder } = client.embedCalls[0];
  assert.equal(typeof responder.notifyQueued, "function");
  await responder.notifyQueued("x"); // 무동작이므로 던지지 않는다
});

// ── 텍스트 채널 폴백 (대시보드 전용 사용 시 임베드) ───────────

test("텍스트 채널이 없으면 서버가 지정한 봇 전용 채널로 채운다", async () => {
  mockResolve = () => ok("곡A");
  mockBotChannelId = "botCh";
  const botChannel = makeChannel("botCh");
  const client = makeClient();
  const guild = makeGuild({ channels: [botChannel] });
  client.players.set(GUILD_ID, { textChannel: null, voiceChannel: null, queue: [] });

  await requestPlayback(client, { guild, requester: { id: "u1" }, query: "곡A" });
  assert.equal(client.players.get(GUILD_ID).textChannel, botChannel);
});

test("봇 전용 채널이 미설정이면 아무 채널도 추측하지 않는다", async () => {
  mockResolve = () => ok("곡A");
  mockBotChannelId = null;
  const client = makeClient();
  const guild = makeGuild({ channels: [makeChannel("random")] });
  client.players.set(GUILD_ID, { textChannel: null, voiceChannel: null, queue: [] });

  await requestPlayback(client, { guild, requester: { id: "u1" }, query: "곡A" });
  assert.equal(client.players.get(GUILD_ID).textChannel, null);
});

test("호출자가 텍스트 채널을 주면 봇 채널을 조회하지 않는다", async () => {
  mockResolve = () => ok("곡A");
  mockBotChannelId = "botCh";
  const client = makeClient();
  const given = makeChannel("given");
  const guild = makeGuild({ channels: [makeChannel("botCh")] });
  client.players.set(GUILD_ID, { textChannel: null, voiceChannel: null, queue: [] });

  await requestPlayback(client, { guild, requester: { id: "u1" }, query: "곡A", textChannel: given });
  assert.equal(client.players.get(GUILD_ID).textChannel, given);
});
