// 재생 조작 세 진입점(슬래시 명령 · 패널 버튼 · 대시보드)이 지금 무엇을 거절하고 무엇을 허용하나.
//
// 전제 조건을 바꾸면 바뀌는 셀을 이 표에서 같이 고친다.
//
// 셀의 값은 진입점이 플레이어에 대고 부른 메서드 이름이다. 아무것도 안 불렀으면 x, 버튼이 모달만 열었으면 modal.
// 답장 문구는 보지 않는다(문구는 ui/ 의 문장표가 맡는다).

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("./helpers/listen.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { ButtonInteraction } from "discord.js";
import { Player } from "../src/player/player.ts";
import { fake, fakeWith, fakeBot } from "./helpers/fake.ts";
import { command, run } from "./helpers/commands.ts";
import { signedInAs } from "./helpers/dashboard.ts";

// 권한은 진짜 판정을 쓴다. 판정 자체는 permissions.test.ts 가 본다.
// 봇이 음성에 없어 재적 규칙은 늘 통과한다. "denied" 셀만 서버에 DJ 역할을 걸어, 그 역할이 없는 이 멤버를 막는다
const { openTempStore, setGuild } = await import("./helpers/temp-store.ts");
const store = openTempStore("control-entrances-");
after(() => store.close());

import express from "express";
import { interactionKind } from "./helpers/interaction-kind.ts";
const interactionCreate = (await import("../src/discord/events/interaction-create.ts")).default;
const { createGuildsRouter } = await import("../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../src/dashboard/player-stream.ts");

// ── 상태 ─────────────────────────────────────────────────────────────

const STATES = ["none", "denied", "idle", "alone", "playing", "loopTrack", "live", "starting"];

type FakeTrack = { title: string; url: string; duration: number; platform: string; isLive?: boolean };
const track = (title: string, extra: Partial<FakeTrack> = {}): FakeTrack => ({ title, url: `https://youtu.be/${title}`, duration: 180, platform: "youtube", ...extra });

function makePlayer(state: string, acts: string[]) {
  // 부른 메서드 이름을 적고 ret 의 값을 돌려준다
  const rec =
    (name: string, ret: (...args: unknown[]) => unknown = () => true) =>
    (...args: unknown[]) => {
      acts.push(name);
      return ret(...args);
    };
  const p = {
    guild: { id: "g1" },
    sessionId: "S1",
    currentTrack: track("now") as FakeTrack | null,
    // 대기열 ID는 track-state 가 추가할 때 찍는다. 대시보드는 그것으로 가리킨다
    queue: [
      { ...track("q1"), entry: 1 },
      { ...track("q2"), entry: 2 },
    ],
    previousTracks: [track("p1")],
    loop: false as string | false,
    paused: false,
    volume: 50,
    isPlayStarting: false,
    pauseFor: rec("pause"),
    resumeFor: rec("resume"),
    skip: rec("skip"),
    dispose: rec("dispose", async () => {}),
    _trackLabel: () => '"now"',
    previous: rec("previous"),
    _restartsOnPrevious: Player.prototype._restartsOnPrevious,
    seek: rec("seek", async () => ({ success: true })),
    play: rec("play", async () => ({ success: true })),
    setVolume: rec("setVolume", (v) => v),
    setLoop: rec("setLoop", (m) => m),
    shuffleQueue: rec("shuffleQueue"),
    clearQueue: rec("clearQueue", () => 2),
    removeFromQueue: rec("removeFromQueue", () => track("q1")),
    moveInQueue: rec("moveInQueue"),
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
    audioPlayer: { state: { status: "playing" } },
  };
  if (state === "idle") Object.assign(p, { currentTrack: null, queue: [], previousTracks: [] });
  if (state === "alone") Object.assign(p, { queue: [], previousTracks: [] });
  if (state === "loopTrack") Object.assign(p, { queue: [], previousTracks: [], loop: "track" });
  if (state === "live") p.currentTrack = track("live", { isLive: true, duration: 0 });
  if (state === "starting") p.isPlayStarting = true;
  return p;
}

const member = { id: "u1", user: { id: "u1" }, voice: { channel: null }, permissions: { has: () => false }, roles: { cache: new Map() }, toString: () => "<@u1>", guild: null as object | null };
const guild = {
  id: "g1",
  name: "서버",
  roles: { cache: new Map([["dj", { id: "dj" }]]) },
  channels: { cache: new Map() },
  voiceStates: { cache: new Map() },
  members: { fetch: async () => member, me: { voice: { channel: null } } },
};
member.guild = guild;
const client = {
  isReady: () => true,
  guilds: { cache: new Map([["g1", guild]]) },
};
const players = new Map<string, Player>();
const bot = fakeBot({ client, players, panels: { updatePlaying: async () => {}, drawEndedPanel: async () => {}, panelChannel: async () => null } });

// 한 셀을 세운다. 부른 메서드를 모을 곳을 돌려준다
function arrange(state: string) {
  const acts: string[] = [];
  players.clear();
  setGuild("g1", { djRoles: state === "denied" ? ["dj"] : [] });
  if (state !== "none") players.set("g1", fake<Player>(makePlayer(state, acts)));
  return acts;
}

const outcome = (acts: string[], extra: string[] = []) => (acts.length ? acts.join("+") : extra.includes("modal") ? "modal" : "x");

// ── 진입점 셋 ───────────────────────────────────────────────────────────

function fakeInteraction({ customId = null as string | null, options = {} as Record<string, string | number> } = {}) {
  const shown: string[] = [];
  const it = fakeWith<ButtonInteraction>()({
    guild,
    member,
    user: member.user,
    client,
    customId,
    channel: {},
    ...interactionKind("button"),
    options: { getString: (n: string) => options[n] ?? null, getInteger: (n: string) => options[n] ?? null },
    reply: async () => {
      it.replied = true;
      return { resource: { message: { id: "r1" } } };
    },
    deferReply: async () => {
      it.deferred = true;
    },
    editReply: async () => {},
    deleteReply: async () => {},
    followUp: async () => ({ id: "f1" }),
    deferUpdate: async () => {},
    showModal: async () => shown.push("modal"),
  });
  return { it, shown };
}

async function viaCommand(op: string, state: string) {
  const { name, options } = COMMAND[op];
  const acts = arrange(state);
  const { it, shown } = fakeInteraction({ options });
  await run(await command(name), it, bot);
  return outcome(acts, shown);
}

async function viaButton(op: string, state: string) {
  const acts = arrange(state);
  const { it, shown } = fakeInteraction({ customId: `panel:${BUTTON[op]}:S1` });
  await interactionCreate.execute(bot, it);
  return outcome(acts, shown);
}

let server: Server | undefined;
let base: string;
async function viaDashboard(op: string, state: string) {
  const { method = "POST", route, body = {} } = DASHBOARD[op];
  const acts = arrange(state);
  await fetch(`${base}/api/guilds/g1/player/${route}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return outcome(acts);
}

const COMMAND: Record<string, { name: string; options?: Record<string, string | number> }> = {
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
// 재생 패널 버튼의 동작 이름(custom_id 는 panel:동작:세션)
const BUTTON: Record<string, string> = {
  pause: "pause",
  skip: "skip",
  stop: "stop",
  previous: "previous",
  highlight: "highlight",
  volume: "volume",
  loop: "loop",
  shuffle: "shuffle",
};
const DASHBOARD: Record<string, { method?: string; route: string; body?: object }> = {
  pause: { route: "pause" },
  skip: { route: "skip" },
  stop: { route: "stop" },
  previous: { route: "previous" },
  seek: { route: "seek", body: { position: 30 } },
  volume: { route: "volume", body: { volume: 50 } },
  loop: { route: "loop", body: { mode: "track" } },
  shuffle: { route: "shuffle" },
  remove: { method: "DELETE", route: "queue/entry/1" },
  move: { route: "queue/move-entry", body: { entry: 1, before: null } },
};

// ── 표 ───────────────────────────────────────────────────────────────
//
/** 진입점: 명령 · 버튼 · 대시보드 */
type Entrance = "C" | "B" | "D";
const ENTRANCES: Entrance[] = ["C", "B", "D"];

//            none   denied idle  alone  playing loopTrack live  starting
// alone: 곡은 있고 대기열·기록이 빔(건너뛰면 대기열 소진으로 끝난다). live: 지금 곡이 라이브, 대기열 2곡. starting: play() 가 도는 중.

const TABLE: Record<string, Partial<Record<Entrance, string>>> = {
  pause: {
    C: "x x x pause pause pause pause pause",
    B: "x x x pause pause pause pause pause",
    D: "x x x pause pause pause pause pause",
  },
  skip: {
    C: "x x x skip skip skip skip skip",
    B: "x x x skip skip skip skip skip",
    D: "x x x skip skip skip skip skip",
  },
  stop: {
    C: "x x dispose dispose dispose dispose dispose dispose", // 곡이 없어도 멈춘다(버린다)
    B: "x x dispose dispose dispose dispose dispose dispose",
    D: "x x dispose dispose dispose dispose dispose dispose",
  },
  previous: {
    C: "x x x x previous previous previous previous",
    B: "x x x x previous previous previous previous",
    D: "x x x x previous previous previous previous",
  },
  seek: {
    C: "x x x seek seek seek x x",
    D: "x x x seek seek seek x x",
  },
  replay: {
    C: "x x x seek seek seek x x",
  },
  highlight: {
    C: "x x x seek seek seek x x",
    B: "x x x seek seek seek x x",
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
    C: "x x dispose dispose dispose dispose dispose dispose",
  },
};

const ENTRANCE = { C: viaCommand, B: viaButton, D: viaDashboard };
const NAME = { C: "명령", B: "버튼", D: "대시보드" };

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(signedInAs(() => ({ id: "u1", username: "u1" })));
  app.locals.bot = bot;
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
  server = await listenForFetch(app);
  base = baseUrl(server);
});

after(() => server?.close());

for (const [op, row] of Object.entries(TABLE)) {
  for (const key of ENTRANCES) {
    const line = row[key];
    if (!line) continue;
    test(`${op} · ${NAME[key]}`, async () => {
      const expected = line.split(" ");
      assert.equal(expected.length, STATES.length, "표의 열 수");
      const actual: string[] = [];
      for (const state of STATES) actual.push(await ENTRANCE[key](op, state));
      assert.deepEqual(Object.fromEntries(STATES.map((s, i) => [s, actual[i]])), Object.fromEntries(STATES.map((s, i) => [s, expected[i]])));
    });
  }
}
