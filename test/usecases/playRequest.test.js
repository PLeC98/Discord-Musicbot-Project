"use strict";

// src/usecases/addTracks.js — 곡 추가 경로의 단일 코어.
//
// 회귀 대상: 슬래시 명령/전용 채널/검색 선택은 handleMusicData를, 대시보드는 addTrack을 타서
// 코어가 둘로 갈려 있었다. 같은 버그를 두 번 고쳐야 했고 요청자 모양도 서로 달랐다.

const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

// ── 모킹 (playRequest보다 먼저 — 실 SQLite/네트워크 미접촉) ──────────────
const { openTempStore, setGuild } = require("../helpers/tempStore");
const store = openTempStore("play-request-");
after(() => store.close());
setGuild("g1", { playlistAddMax: 50 });

let mockResolve = null;
const resolverCalls = [];
const trPath = require.resolve(path.join(__dirname, "..", "..", "src", "sources", "trackResolver.js"));
require.cache[trPath] = {
  id: trPath,
  filename: trPath,
  loaded: true,
  exports: {
    async resolveQuery(query, context, range) {
      resolverCalls.push({ query, context, range });
      return mockResolve(query);
    },
    async getCollection(url, range) {
      collectionCalls.push({ url, range });
      return mockCollection(range);
    },
  },
};
let mockCollection = null;
const collectionCalls = [];

const { requestPlayback, continueCollection, toRequester, ensurePlayer } = require("../../src/usecases/addTracks");

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
      queueFullMessage: () => "대기열이 가득 찼습니다",
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

// 표시에 쓰는 이름은 그 서버에서 보이는 이름이다. GuildMember에는 username이 없어
// 전역 계정명(user.username)이 먼저 잡히면 닉네임이 영영 쓰이지 않는다 — displayName을 먼저 본다.
test("toRequester: GuildMember는 서버 닉네임(displayName)을 쓴다", () => {
  const member = { id: "u1", user: { username: "carl", tag: "carl#0" }, displayName: "칼" };
  assert.deepEqual(toRequester(member), { id: "u1", username: "칼", tag: "carl#0" });
});

test("toRequester: 닉네임이 없으면 전역 계정명으로 떨어진다", () => {
  const member = { id: "u1", user: { username: "carl", tag: "carl#0" } };
  assert.equal(toRequester(member).username, "carl");
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
  client.players.set(GUILD_ID, { textChannel: makeChannel("t"), voiceChannel: null, queue: [], loop: false, releaseLoopForLive() {}, hasLiveTrack: () => false });
  return { guild, requester: { id: "u1", user: { username: "carl" } }, ...extra };
}

// 방송 중인 라이브는 주소를 ffmpeg에 넘기는 갈래로 재생한다. 더 이상 입구에서 막지 않는다.
test("방송 중인 라이브는 통과시킨다", async () => {
  mockResolve = () => ({ success: true, isPlaylist: false, tracks: [{ title: "24/7 라디오", url: "https://y/live", duration: 0, isLive: true, liveStatus: "is_live" }] });
  const client = makeClient();
  const guild = makeGuild();

  await requestPlayback(client, baseArgs(client, guild, { query: "https://y/live", source: "/play" }));

  const sent = client.embedCalls[0].trackData.tracks.map((t) => t.title);
  assert.deepEqual(sent, ["24/7 라디오"]);
});

// 아직 시작하지 않은 방송은 열어 봐야 받을 것이 없다.
// 조용히 버리면 로그만 흐르고 디스코드에는 아무 반응이 없어 먹통처럼 보였다 — 이유를 말하고 거절한다.
test("시작 전 방송은 거절하고 이유를 알린다", async () => {
  mockResolve = () => ({ success: true, isPlaylist: false, tracks: [{ title: "곧 시작", url: "https://y/soon", duration: 0, isLive: true, liveStatus: "is_upcoming" }] });
  const client = makeClient();
  const guild = makeGuild();

  const result = await requestPlayback(client, baseArgs(client, guild, { query: "https://y/soon", source: "/play" }));

  assert.equal(result.success, false);
  assert.match(result.message, /시작하지 않은/);
  assert.equal(client.embedCalls.length, 0, "코어까지 가지 않는다");
});

// 재생목록에 시작 전 방송이 섞여 있으면 그것만 빼고 나머지는 넣는다.
test("재생목록의 시작 전 방송만 걸러내고 나머지는 넣는다", async () => {
  mockResolve = () => ({
    success: true,
    isPlaylist: true,
    collection: "playlist",
    tracks: [
      { title: "곧 시작", url: "https://y/soon", duration: 0, isLive: true, liveStatus: "is_upcoming" },
      { title: "보통곡", url: "https://y/ok", duration: 100 },
    ],
  });
  const client = makeClient();
  const guild = makeGuild();

  await requestPlayback(client, baseArgs(client, guild, { query: "https://y/list", source: "/play" }));

  const sent = client.embedCalls[0].trackData.tracks.map((t) => t.title);
  assert.deepEqual(sent, ["보통곡"]);
});

// 끝이 없는 것은 반복할 수 없다. 라이브가 들어오면 걸려 있던 반복을 푼다.
test("라이브가 대기열에 들어오면 반복을 푼다", async () => {
  mockResolve = () => ({ success: true, isPlaylist: false, tracks: [{ title: "24/7 라디오", url: "https://y/live", duration: 0, isLive: true, liveStatus: "is_live" }] });
  const client = makeClient();
  const guild = makeGuild();
  const args = baseArgs(client, guild, { query: "https://y/live", source: "/play" });
  let released = 0;
  const player = client.players.get(GUILD_ID);
  player.loop = "queue";
  player.releaseLoopForLive = () => {
    released++;
    player.loop = false;
  };

  await requestPlayback(client, args);

  assert.equal(released, 1);
  assert.equal(player.loop, false);
});

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
  setGuild(GUILD_ID, { botChannel: "botCh" });
  const botChannel = makeChannel("botCh");
  const client = makeClient();
  const guild = makeGuild({ channels: [botChannel] });
  client.players.set(GUILD_ID, { textChannel: null, voiceChannel: null, queue: [] });

  await requestPlayback(client, { guild, requester: { id: "u1" }, query: "곡A" });
  assert.equal(client.players.get(GUILD_ID).textChannel, botChannel);
});

test("봇 전용 채널이 미설정이면 아무 채널도 추측하지 않는다", async () => {
  mockResolve = () => ok("곡A");
  setGuild(GUILD_ID, { botChannel: null });
  const client = makeClient();
  const guild = makeGuild({ channels: [makeChannel("random")] });
  client.players.set(GUILD_ID, { textChannel: null, voiceChannel: null, queue: [] });

  await requestPlayback(client, { guild, requester: { id: "u1" }, query: "곡A" });
  assert.equal(client.players.get(GUILD_ID).textChannel, null);
});

test("호출자가 텍스트 채널을 주면 봇 채널을 조회하지 않는다", async () => {
  mockResolve = () => ok("곡A");
  setGuild(GUILD_ID, { botChannel: "botCh" });
  const client = makeClient();
  const given = makeChannel("given");
  const guild = makeGuild({ channels: [makeChannel("botCh")] });
  client.players.set(GUILD_ID, { textChannel: null, voiceChannel: null, queue: [] });

  await requestPlayback(client, { guild, requester: { id: "u1" }, query: "곡A", textChannel: given });
  assert.equal(client.players.get(GUILD_ID).textChannel, given);
});

// ── 받을 곡 수 (해석기에 넘기는 어림값) ──────────────────────

async function withLimits(queueMax, playlistMax, fn) {
  const config = require("../../config");
  const saved = config.bot.maxQueueSize;
  config.bot.maxQueueSize = queueMax;
  setGuild(GUILD_ID, { playlistAddMax: playlistMax });
  try {
    await fn();
  } finally {
    config.bot.maxQueueSize = saved;
    setGuild(GUILD_ID, { playlistAddMax: 50 });
  }
}

async function requestWith({ queued = 0, playing = false, single = false, resolve = () => ok("곡A") }) {
  mockResolve = resolve;
  const client = makeClient();
  const args = baseArgs(client, makeGuild(), { query: "목록", single });
  const player = client.players.get(GUILD_ID);
  player.queue = Array.from({ length: queued }, (_, i) => track(`q${i}`));
  if (playing) player.currentTrack = track("now");
  await requestPlayback(client, args);
  return { limit: resolverCalls.at(-1).range.limit, trackData: client.embedCalls[0]?.trackData };
}

test("받을 곡 수: 한 번에 넣는 묶음과 남은 자리 중 작은 쪽", () =>
  withLimits(30, 50, async () => {
    assert.equal((await requestWith({ playing: true })).limit, 30);
    assert.equal((await requestWith({ playing: true, queued: 25 })).limit, 5);
    // 비어 있으면 첫 곡은 현재곡이 되니 한 자리 더(31)를 셈하지만, 묶음이 대기열 상한(30)으로 잘려 있어 30에서 멈춘다
    assert.equal((await requestWith({ playing: false })).limit, 30);
    assert.equal((await requestWith({ playing: true, queued: 30 })).limit, 1, "가득 차도 한 곡은 받아 추가 구간이 실패를 알린다");
    assert.equal((await requestWith({ playing: true, single: true })).limit, 1);
  }));

test("받을 곡 수: 상한이 꺼져 있으면 묶음 크기", () =>
  withLimits(0, 50, async () => {
    assert.equal((await requestWith({ playing: true, queued: 400 })).limit, 50);
  }));

test("자리가 모자라 덜 받았고 뒤에 곡이 더 있을 때만 queueLimited", () =>
  withLimits(30, 50, async () => {
    const five = () => ({ ...ok("1", "2", "3", "4", "5"), total: 80 });
    assert.equal((await requestWith({ playing: true, queued: 25, resolve: five })).trackData.queueLimited, true);

    const room = () => ({ ...ok(...Array.from({ length: 25 }, (_, i) => `s${i}`)), total: 80 });
    assert.equal((await requestWith({ playing: true, queued: 5, resolve: room })).trackData.queueLimited, true, "남은 자리 25가 묶음 30보다 작다");

    const whole = () => ({ ...ok("1", "2", "3"), total: 3 });
    assert.equal((await requestWith({ playing: true, queued: 25, resolve: whole })).trackData.queueLimited, undefined, "목록을 다 받았으면 아니다");
  }));

// ── 재생목록 이어 넣기 ───────────────────────────────────────

const SP = "37i9dQZF1E3aglU7q0y10F";
const idOf = (i) => `t${String(i).padStart(21, "0")}`; // 22자 트랙 ID

// 원본 목록 — shift만큼 앞에 새 곡이 끼어든 상태를 흉내 낼 수 있다(원래 i번째 곡이 i+shift 자리)
function listSource(size, { shift = 0 } = {}) {
  return ({ offset, limit }) => {
    const tracks = [];
    for (let raw = offset; raw < Math.min(size + shift, offset + limit); raw++) {
      const i = raw - shift;
      tracks.push(i < 0 ? { title: `new${raw}`, id: `n${String(raw).padStart(21, "0")}` } : { title: `s${i}`, id: idOf(i) });
    }
    return { tracks, total: size + shift, nextOffset: offset + tracks.length };
  };
}

function stateAt(offset, extra = {}) {
  return { kind: "spp", listId: SP, offset, anchorId: idOf(offset - 1), insertFirst: false, requesterId: null, ...extra };
}

async function continueWith({ state, count, size = 300, shift = 0, queued = 0 }) {
  mockCollection = listSource(size, { shift });
  collectionCalls.length = 0;
  const client = makeClient();
  const guild = makeGuild();
  baseArgs(client, guild);
  const player = client.players.get(GUILD_ID);
  player.queue = Array.from({ length: queued }, (_, i) => track(`q${i}`));
  player.currentTrack = track("now");
  const progress = [];
  const result = await continueCollection(client, { guild, requester: { id: "u1" }, state, count, onProgress: (done, want) => progress.push([done, want]) });
  return { result, progress, added: client.embedCalls[0]?.trackData };
}

const addedTitles = (trackData) => trackData.tracks.map((t) => t.title);

test("이어 넣기: 앵커 뒤부터 넣고, 다음 위치·앵커·남은 곡을 넘겨준다", () =>
  withLimits(250, 50, async () => {
    const { result, added } = await continueWith({ state: stateAt(50), count: 50 });
    assert.deepEqual(collectionCalls[0].range, { offset: 45, limit: 55 }, "앵커를 찾으려고 앞으로 더 받는다");
    assert.deepEqual(addedTitles(added).slice(0, 2), ["s50", "s51"]);
    assert.equal(added.tracks.length, 50);
    assert.equal(result.added, 50);
    assert.deepEqual({ offset: result.next.offset, anchorId: result.next.anchorId, remaining: result.next.remaining }, { offset: 100, anchorId: idOf(99), remaining: 200 });
  }));

test("이어 넣기: 목록 앞에 곡이 끼어들어도 앵커가 이어 준다 — 빠지거나 겹치는 곡이 없다", () =>
  withLimits(250, 50, async () => {
    const { added } = await continueWith({ state: stateAt(50), count: 50, shift: 2 });
    assert.deepEqual(
      addedTitles(added),
      Array.from({ length: 50 }, (_, i) => `s${50 + i}`),
    );
  }));

test("이어 넣기: 누른 시점의 남은 자리로 자르고, 자리가 없으면 받지도 않는다", () =>
  withLimits(30, 50, async () => {
    const some = await continueWith({ state: stateAt(50), count: 100, queued: 25 });
    assert.equal(some.added.tracks.length, 5);

    const full = await continueWith({ state: stateAt(50), count: 100, queued: 30 });
    assert.equal(full.result.success, false);
    assert.equal(collectionCalls.length, 0);
  }));

test("이어 넣기: 여러 묶음으로 받으며 진행을 알린다", () =>
  withLimits(0, 50, async () => {
    const { progress, added } = await continueWith({ state: stateAt(50), count: 250, size: 1000 });
    assert.equal(collectionCalls.length, 3);
    assert.deepEqual(progress, [
      [100, 250],
      [200, 250],
      [250, 250],
    ]);
    assert.equal(added.tracks.length, 250);
  }));

test("이어 넣기: 목록 끝이면 넣을 수 있는 만큼 넣고 다음 상태가 없다", () =>
  withLimits(250, 50, async () => {
    const { result, added } = await continueWith({ state: stateAt(50), count: 50, size: 80 });
    assert.equal(added.tracks.length, 30);
    assert.equal(result.next, null);
    assert.equal(result.remaining, 0);
  }));

test("이어 넣기: 맨 앞에 넣었던 목록은 앵커 곡 바로 뒤에 넣게 한다", () =>
  withLimits(250, 50, async () => {
    const front = await continueWith({ state: stateAt(50, { insertFirst: true }), count: 10 });
    assert.equal(front.added.insertAfterId, idOf(49));
    assert.equal(front.result.next.insertFirst, true, "다음 묶음도 같은 자리 규칙을 잇는다");

    const back = await continueWith({ state: stateAt(50), count: 10 });
    assert.equal(back.added.insertAfterId, undefined);
  }));

test("재생목록을 넣으면 이어 받을 상태를 결과에 싣는다", async () => {
  mockResolve = () => ({ ...ok("1", "2"), collection: "playlist", total: 120, nextOffset: 2, tracks: [track("1"), { ...track("2"), id: idOf(1) }] });
  const client = makeClient();
  const result = await requestPlayback(client, baseArgs(client, makeGuild(), { query: `https://open.spotify.com/playlist/${SP}` }));
  assert.equal(result.more.offset, 2);
  assert.equal(result.more.remaining, 118);
});
