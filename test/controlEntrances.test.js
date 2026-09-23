"use strict";

// 재생 조작 세 입구(슬래시 명령 · 패널 버튼 · 대시보드)가 지금 무엇을 거절하고 무엇을 허용하나(구조 리팩터링 0단계).
//
// 같은 조작의 전제 조건이 입구마다 다르다. 6단계가 전제 조건을 코어 한 곳으로 모으면 이 표의 몇 칸이 바뀐다.
// 그때 바뀌는 칸을 이 표에서 고치고, 무엇이 바뀌었는지는 그 커밋이 적는다.
//
// 칸의 값은 입구가 플레이어에 대고 부른 메서드 이름이다. 아무것도 안 불렀으면 x, 버튼이 모달만 띄웠으면 modal.
// 답장 문구는 보지 않는다. 문구는 6단계에서 ui/ 로 옮겨 가며 바뀐다.

process.env.OWNER_ID = "owner";

const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// 권한 판정은 켜고 끄기만 한다. 판정 자체는 permissions.test.js 가 본다
const perm = { deny: false };
const gate = () => (perm.deny ? "❌ 권한이 없습니다" : null);
const permPath = require.resolve("../src/usecases/permissions");
require.cache[permPath] = {
  id: permPath,
  filename: permPath,
  loaded: true,
  exports: { ...require(permPath), checkControl: gate, checkSkip: gate, checkRemoveTrack: gate, checkAdd: gate, checkSummon: gate, isModerator: () => false },
};
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "store", "guildSettings.js"));
require.cache[gsmPath] = { id: gsmPath, filename: gsmPath, loaded: true, exports: { getDjRoles: async () => [], getBotChannel: async () => null } };

const express = require("express");
const buttonHandler = require("../events/buttonHandler");

// ── 상태 ─────────────────────────────────────────────────────────────

const STATES = ["none", "denied", "idle", "alone", "playing", "loopTrack", "live", "starting"];

const track = (title, extra = {}) => ({ title, url: `https://youtu.be/${title}`, duration: 180, platform: "youtube", ...extra });

function makePlayer(state, acts) {
  const rec =
    (name, ret = true) =>
    (...args) => {
      acts.push(name);
      return typeof ret === "function" ? ret(...args) : ret;
    };
  const p = {
    sessionId: "S1",
    currentTrack: track("now"),
    queue: [track("q1"), track("q2")],
    previousTracks: [track("p1")],
    loop: false,
    paused: false,
    volume: 50,
    isPlayStarting: false,
    pause: rec("pause"),
    resume: rec("resume"),
    skip: rec("skip"),
    stop: rec("stop"),
    previous: rec("previous"),
    seek: rec("seek", async () => ({ success: true })),
    play: rec("play", async () => ({ success: true })),
    setVolume: rec("setVolume", (v) => v),
    setLoop: rec("setLoop", (m) => m),
    shuffleQueue: rec("shuffleQueue"),
    clearQueue: rec("clearQueue", 2),
    removeFromQueue: rec("removeFromQueue", () => track("q1")),
    moveInQueue: rec("moveInQueue"),
    leaveAndSave: rec("leaveAndSave", async () => {}),
    get isLive() {
      return Boolean(this.currentTrack?.isLive);
    },
    get sponsor() {
      return this.currentTrack ? { highlightAt: 42 } : null;
    },
    hasLiveTrack() {
      return Boolean(this.currentTrack?.isLive || this.queue.some((t) => t.isLive));
    },
    getCurrentTime: () => 0,
    getQueue() {
      return { current: this.currentTrack, queue: this.queue };
    },
    getStatus: () => ({ playing: true, paused: false, volume: 50, loop: false }),
    isPlaybackActive: () => true,
  };
  if (state === "idle") Object.assign(p, { currentTrack: null, queue: [], previousTracks: [] });
  if (state === "alone") Object.assign(p, { queue: [], previousTracks: [] });
  if (state === "loopTrack") Object.assign(p, { queue: [], previousTracks: [], loop: "track" });
  if (state === "live") p.currentTrack = track("live", { isLive: true, duration: 0 });
  if (state === "starting") p.isPlayStarting = true;
  return p;
}

const member = { id: "u1", user: { id: "u1" }, voice: { channel: null }, toString: () => "<@u1>" };
const guild = {
  id: "g1",
  name: "서버",
  roles: { cache: new Map() },
  channels: { cache: new Map() },
  voiceStates: { cache: new Map() },
  members: { fetch: async () => member, me: { voice: { channel: null } } },
};
const client = {
  isReady: () => true,
  guilds: { cache: new Map([["g1", guild]]) },
  players: new Map(),
  musicEmbedManager: { updateNowPlayingEmbed: async () => {}, handlePlaybackEnd: async () => {} },
};

// 한 칸을 세운다. 부른 메서드를 모을 곳을 돌려준다
function arrange(state) {
  const acts = [];
  client.players.clear();
  perm.deny = state === "denied";
  if (state !== "none") client.players.set("g1", makePlayer(state, acts));
  return acts;
}

const outcome = (acts, extra = []) => (acts.length ? acts.join("+") : extra.includes("modal") ? "modal" : "x");

// ── 입구 셋 ───────────────────────────────────────────────────────────

function fakeInteraction({ customId = null, options = {} } = {}) {
  const shown = [];
  const it = {
    guild,
    member,
    user: member.user,
    client,
    customId,
    channel: {},
    isButton: () => true,
    options: { getString: (n) => options[n] ?? null, getInteger: (n) => options[n] ?? null },
    reply: async () => {
      it.replied = true;
    },
    deferReply: async () => {
      it.deferred = true;
    },
    editReply: async () => {},
    deferUpdate: async () => {},
    showModal: async () => shown.push("modal"),
  };
  return { it, shown };
}

async function viaCommand(op, state) {
  const { name, options } = COMMAND[op];
  const acts = arrange(state);
  const { it, shown } = fakeInteraction({ options });
  await require(`../commands/${name}.js`).execute(it, client);
  return outcome(acts, shown);
}

async function viaButton(op, state) {
  const acts = arrange(state);
  const { it, shown } = fakeInteraction({ customId: `${BUTTON[op]}:u1:S1` });
  await buttonHandler.execute(it);
  return outcome(acts, shown);
}

let server;
let base;
async function viaDashboard(op, state) {
  const { method = "POST", route, body = {} } = DASHBOARD[op];
  const acts = arrange(state);
  await fetch(`${base}/api/guilds/g1/player/${route}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return outcome(acts);
}

const COMMAND = {
  pause: { name: "pause" },
  skip: { name: "skip" },
  stop: { name: "stop" },
  previous: { name: "previous" },
  seek: { name: "seek", options: { time: "0:30" } },
  replay: { name: "replay" },
  highlight: { name: "highlight" },
  volume: { name: "volume", options: { level: 50 } },
  loop: { name: "loop", options: { mode: "track" } },
  shuffle: { name: "shuffle" },
  remove: { name: "remove", options: { position: 1 } },
  move: { name: "move", options: { from: 1, to: 2 } },
  clear: { name: "clear" },
  leave: { name: "leave" },
};
const BUTTON = {
  pause: "music_pause",
  skip: "music_skip",
  stop: "music_stop",
  previous: "music_previous",
  highlight: "music_highlight",
  volume: "music_volume",
  loop: "music_loop",
  shuffle: "music_shuffle",
};
const DASHBOARD = {
  pause: { route: "pause" },
  skip: { route: "skip" },
  stop: { route: "stop" },
  previous: { route: "previous" },
  seek: { route: "seek", body: { position: 30 } },
  volume: { route: "volume", body: { volume: 50 } },
  loop: { route: "loop", body: { mode: "track" } },
  shuffle: { route: "shuffle" },
  remove: { method: "DELETE", route: "queue/0" },
  move: { route: "queue/move", body: { from: 0, to: 1 } },
};

// ── 표 ───────────────────────────────────────────────────────────────
//
//            none   denied idle  alone  playing loopTrack live  starting
// alone: 곡은 있고 대기열·기록이 빔. live: 지금 곡이 라이브, 대기열 2곡. starting: play() 가 도는 중.

const TABLE = {
  pause: {
    C: "x x x pause pause pause pause pause",
    B: "x x x pause pause pause pause pause",
    D: "x x x pause pause pause pause pause",
  },
  skip: {
    C: "x x x x skip skip skip skip",
    B: "x x x x skip skip skip skip",
    D: "x x x skip skip skip skip skip", // 빈 대기열을 거절하지 않는다
  },
  stop: {
    C: "x x stop stop stop stop stop stop", // 곡이 없어도 멈춘다
    B: "x x stop stop stop stop stop stop",
    D: "x x stop stop stop stop stop stop",
  },
  previous: {
    C: "x x x x previous previous previous previous",
    B: "x x x x previous previous previous previous",
    D: "x x x x previous previous previous previous",
  },
  seek: {
    C: "x x x seek seek seek x seek",
    D: "x x x seek seek seek x x", // 대시보드만 play() 도는 중을 거절한다
  },
  replay: {
    C: "x x x seek seek seek x seek",
  },
  highlight: {
    C: "x x x seek seek seek x seek",
    B: "x x x play play play play play", // 버튼은 seek 을 안 거치고 play 를 부르며, 라이브를 거절하지 않는다
  },
  volume: {
    C: "x x setVolume setVolume setVolume setVolume setVolume setVolume",
    B: "x x modal modal modal modal modal modal",
    D: "x x setVolume setVolume setVolume setVolume setVolume setVolume",
  },
  loop: {
    C: "x x x setLoop setLoop setLoop x setLoop",
    B: "x x x setLoop setLoop setLoop x setLoop",
    D: "x x x setLoop setLoop setLoop x setLoop",
  },
  shuffle: {
    C: "x x x x shuffleQueue x shuffleQueue shuffleQueue",
    B: "x x x x shuffleQueue x shuffleQueue shuffleQueue",
    D: "x x x x shuffleQueue x shuffleQueue shuffleQueue",
  },
  remove: {
    C: "x x x x removeFromQueue x removeFromQueue removeFromQueue",
    D: "x x x x removeFromQueue x removeFromQueue removeFromQueue",
  },
  move: {
    C: "x x x x moveInQueue x moveInQueue moveInQueue",
    D: "x x x x moveInQueue x moveInQueue moveInQueue",
  },
  clear: {
    C: "x x x x clearQueue x clearQueue clearQueue",
  },
  leave: {
    C: "x x leaveAndSave leaveAndSave leaveAndSave leaveAndSave leaveAndSave leaveAndSave",
  },
};

const ENTRANCE = { C: viaCommand, B: viaButton, D: viaDashboard };
const NAME = { C: "명령", B: "버튼", D: "대시보드" };

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { id: "u1", username: "u1", guilds: [] } };
    next();
  });
  app.locals.discordClient = client;
  app.use("/api/guilds", require("../dashboard/server/routes/guilds.js"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

for (const [op, row] of Object.entries(TABLE)) {
  for (const [key, line] of Object.entries(row)) {
    test(`${op} · ${NAME[key]}`, async () => {
      const expected = line.split(" ");
      assert.equal(expected.length, STATES.length, "표의 칸 수");
      const actual = [];
      for (const state of STATES) actual.push(await ENTRANCE[key](op, state));
      assert.deepEqual(Object.fromEntries(STATES.map((s, i) => [s, actual[i]])), Object.fromEntries(STATES.map((s, i) => [s, expected[i]])));
    });
  }
}
