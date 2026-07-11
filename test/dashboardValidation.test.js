"use strict";

// dashboard/server/routes/guilds.js — 플레이어 조작 API의 입력 검증 (감사 M-07).
// 회귀 대상: 비문자열 query의 TypeError(async 핸들러라 응답 없는 unhandled rejection),
// parseFloat("Infinity")·parseInt("50junk")의 느슨한 통과, 제어문자의 로그/yt-dlp 유입.
// 실 라우터 + fake client/player, isAdmin 세션으로 권한 게이트를 우회해 검증 로직만 조준.

const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// ── GuildSettingsManager 모킹 (라우터 require 전에 — 실 SQLite 미접촉) ──────
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "GuildSettingsManager.js"));
require.cache[gsmPath] = {
  id: gsmPath,
  filename: gsmPath,
  loaded: true,
  exports: {
    getDjRoles: async () => [],
    setDjRoles: async () => true,
    clearDjRoles: async () => {},
    getBotChannel: async () => null,
    setBotChannel: async () => true,
    clearBotChannel: async () => {},
  },
};

const express = require("express");

// ── Fake client/player ───────────────────────────────────────
const GUILD_ID = "100";

function makeTrack(title) {
  return { title, artist: "a", duration: 300, thumbnail: null, url: "u", platform: "youtube", requestedBy: null };
}

function makePlayer() {
  return {
    calls: [],
    currentTrack: makeTrack("현재곡"),
    queue: [makeTrack("q0"), makeTrack("q1"), makeTrack("q2")],
    previousTracks: [],
    volume: 50,
    getStatus() {
      return { playing: true, paused: false, volume: this.volume, loop: false, shuffle: false };
    },
    getCurrentTime: () => 0,
    async play(_, ms) {
      this.calls.push(["play", ms]);
    },
    setVolume(v) {
      this.calls.push(["setVolume", v]);
      this.volume = v;
    },
    async addTrack(query) {
      this.calls.push(["addTrack", query]);
      return { success: true };
    },
    removeFromQueue(i) {
      this.calls.push(["removeFromQueue", i]);
      this.queue.splice(i, 1);
    },
    moveInQueue(from, to) {
      this.calls.push(["moveInQueue", from, to]);
    },
  };
}

let player;
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: new Map() },
  channels: { cache: new Map() },
  members: {
    fetch: async () => {
      throw new Error("Unknown Member"); // isAdmin 세션이라 비멤버여도 통과해야 함
    },
    me: null,
  },
};
const client = {
  isReady: () => true,
  guilds: { cache: new Map([[GUILD_ID, guild]]) },
  players: new Map(),
};

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { id: "owner", username: "owner", isAdmin: true, guilds: [] } };
    next();
  });
  app.locals.discordClient = client;
  app.use("/api/guilds", require("../dashboard/server/routes/guilds.js"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function req(method, urlPath, body) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000), // 구 코드의 무응답(unhandled rejection) 회귀를 행 대신 실패로
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

function freshPlayer() {
  player = makePlayer();
  client.players.set(GUILD_ID, player);
  return player;
}

test("queue add: 비문자열 query(배열/객체/숫자)는 400 — 구 코드는 TypeError로 응답 없음", async () => {
  freshPlayer();
  for (const query of [["a", "b"], { q: "x" }, 42]) {
    const r = await req("POST", `/api/guilds/${GUILD_ID}/player/queue`, { query });
    assert.equal(r.status, 400, JSON.stringify(query));
  }
  assert.equal(player.calls.length, 0, "addTrack 미호출");
});

test("queue add: 길이 상한 초과는 400, 제어문자는 공백 정규화 후 전달", async () => {
  freshPlayer();
  const long = await req("POST", `/api/guilds/${GUILD_ID}/player/queue`, { query: "가".repeat(501) });
  assert.equal(long.status, 400);

  const r = await req("POST", `/api/guilds/${GUILD_ID}/player/queue`, { query: "hello\r\nworld\x00!" });
  assert.equal(r.status, 200);
  const [, sent] = player.calls.find(([name]) => name === "addTrack");
  assert.doesNotMatch(sent, /[\x00-\x1f\x7f]/, "제어문자가 yt-dlp/로그로 흘러가지 않음");
  assert.match(sent, /hello +world +!/);
});

test("seek: Infinity/비숫자/음수는 400 (라이브 duration 0 클램프 우회 차단), 정상값은 ms로 재생", async () => {
  freshPlayer();
  for (const position of ["Infinity", "-Infinity", "junk", -1]) {
    const r = await req("POST", `/api/guilds/${GUILD_ID}/player/seek`, { position });
    assert.equal(r.status, 400, String(position));
  }
  assert.equal(player.calls.length, 0);

  const ok = await req("POST", `/api/guilds/${GUILD_ID}/player/seek`, { position: 30 });
  assert.equal(ok.status, 200);
  assert.deepEqual(player.calls[0], ["play", 30000]);
});

test("volume: '50junk'/소수는 400 — 구 parseInt는 50으로 통과", async () => {
  freshPlayer();
  for (const volume of ["50junk", 50.5, "1e2junk", [50, 60]]) {
    const r = await req("POST", `/api/guilds/${GUILD_ID}/player/volume`, { volume });
    assert.equal(r.status, 400, JSON.stringify(volume));
  }
  const ok = await req("POST", `/api/guilds/${GUILD_ID}/player/volume`, { volume: 70 });
  assert.equal(ok.status, 200);
  assert.deepEqual(player.calls, [["setVolume", 70]]);
});

test("queue delete/move: '1junk'·소수 인덱스는 400, 정수만 통과", async () => {
  freshPlayer();
  const junkDelete = await req("DELETE", `/api/guilds/${GUILD_ID}/player/queue/1junk`);
  assert.equal(junkDelete.status, 400);

  const junkMove = await req("POST", `/api/guilds/${GUILD_ID}/player/queue/move`, { from: "0junk", to: 1 });
  assert.equal(junkMove.status, 400);
  const floatMove = await req("POST", `/api/guilds/${GUILD_ID}/player/queue/move`, { from: 0.5, to: 1 });
  assert.equal(floatMove.status, 400);
  assert.equal(player.calls.length, 0);

  const okMove = await req("POST", `/api/guilds/${GUILD_ID}/player/queue/move`, { from: 0, to: 2 });
  assert.equal(okMove.status, 200);
  const okDelete = await req("DELETE", `/api/guilds/${GUILD_ID}/player/queue/1`);
  assert.equal(okDelete.status, 200);
  assert.deepEqual(player.calls, [
    ["moveInQueue", 0, 2],
    ["removeFromQueue", 1],
  ]);
});
