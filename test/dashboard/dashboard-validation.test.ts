// src/dashboard/routes/guilds.ts — 플레이어 조작 API의 입력 검증
// 회귀 대상: 비문자열 query의 TypeError(async 핸들러라 응답 없는 unhandled rejection),
// parseFloat("Infinity")·parseInt("50junk")의 느슨한 통과, 제어문자의 로그/yt-dlp 유입.
// 실 라우터 + fake client/player, 봇 운영자 세션으로 권한 게이트를 우회해 검증 로직만 조준.

// 봇 운영자 판정은 요청마다 config.dashboard.ownerId와 대조한다 — 세션에 굳은 값이 아니라.
// dotenv는 이미 설정된 process.env를 덮지 않으므로 .env가 있어도 이 값이 이긴다.
process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { BotContext } from "../../src/app/bot-context.ts";
import type { Player } from "../../src/player/player.ts";
import type { Lookup } from "../../src/usecases/add-tracks.ts";
import { fake, fakePlayer, fakeBot } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";
import { textsOf } from "../helpers/cv2.ts";

/** 이 시험이 읽는 답의 칸 */
type Reply = { error?: string; more?: { offset: number; requesterId?: unknown } };

// ── 서버 설정: 진짜를 임시 DB 로 ──────────────────────────
const { openTempStore } = await import("../helpers/temp-store.ts");
const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const playerEvents = await import("../../src/player/events.ts");
const { VOLUME_SETTLE_MS } = await import("../../src/usecases/controls.ts");
// 가짜 플레이어가 빌려 쓰는 진짜 메서드. 설정(OWNER_ID)을 정한 뒤에 불러야 한다
const RealPlayer = (await import("../../src/player/player.ts")).Player;
const { fakeAdder } = await import("../helpers/adder.ts");
const store = openTempStore("dashboard-validation-");
after(() => store.close());

// ── 조회 가짜(코어가 실 해석/네트워크를 타지 않게). 라우터가 app.locals.lookup 을 코어에 넘긴다 ──
const resolverCalls: string[] = [];
const lookup = fake<Lookup>({
  async resolveQuery(query: string) {
    resolverCalls.push(query);
    return { success: true, isPlaylist: false, tracks: [makeTrack("추가곡")] };
  },
  async getCollection(_url: string, { offset, limit }: { offset: number; limit: number }) {
    const tracks = Array.from({ length: limit }, (_, k) => ({ ...makeTrack(`c${offset + k}`), id: `c${String(offset + k).padStart(21, "0")}` }));
    return { tracks, total: 1000, nextOffset: offset + limit };
  },
});

import express from "express";

// ── Fake client/player ───────────────────────────────────────
const GUILD_ID = "100";

function makeTrack(title: string) {
  return { title, artist: "a", duration: 300, thumbnail: null, url: "u", platform: "youtube", requestedBy: null };
}

// 줄 번호가 찍힌 곡(track-state 가 들일 때처럼 열거되지 않는 칸)
const entered = (title: string, entry: number) => Object.defineProperty(makeTrack(title), "entry", { value: entry, enumerable: false });

function makePlayer() {
  return fakePlayer({
    bindChannels: RealPlayer.prototype.bindChannels,
    movePanel: RealPlayer.prototype.movePanel,
    restoreSettings: RealPlayer.prototype.restoreSettings,
    calls: [] as unknown[][],
    currentTrack: makeTrack("현재곡"),
    queue: [entered("q0", 1), entered("q1", 2), entered("q2", 3)],
    previousTracks: [],
    volume: 50,
    loop: false,
    audioPlayer: { state: { status: "playing" } },
    getCurrentTime: () => 0,
    async play(ms: number) {
      this.calls.push(["play", ms]);
    },
    // 위치 이동은 play()를 직접 부르지 않고 seek()를 지난다 — 진입점마다 로그를 다는 대신
    // 통로를 하나로 뒀다(사람이 옮긴 것과 봇이 넘긴 것을 로그에서 갈라야 한다).
    // 넘기기 · 이전 뒤 곡이 바뀔 때까지(가짜는 곧바로 바뀐다)
    async untilSwitched() {},
    async seek(ms: number, reason: string) {
      this.calls.push(["seek", ms, reason]);
    },
    setVolume(v: number) {
      this.calls.push(["setVolume", v]);
      this.volume = v;
    },
    removeFromQueue(i: number) {
      this.calls.push(["removeFromQueue", i]);
      return this.queue.splice(i, 1)[0];
    },
    moveInQueue(from: number, to: number) {
      this.calls.push(["moveInQueue", from, to]);
    },
  });
}

let player: ReturnType<typeof makePlayer>;
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: new Map() },
  channels: { cache: new Map() },
  members: {
    fetch: async () => {
      throw new Error("Unknown Member"); // 운영자 세션이라 비멤버여도 통과해야 함
    },
    me: null,
  },
};
const embedCalls: [string, { tracks: object[]; insertAfterId?: string | null }][] = [];
const client = {
  isReady: () => true,
  guilds: { cache: new Map([[GUILD_ID, guild]]) },
};
const panels = {
  panelChannel: async (): Promise<unknown> => null,
  updatePlaying: async () => {},
};
const bot = fakeBot({ client, players: new Map<string, Player>(), panels });
// 곡 담기는 받은 것만 적는다
fakeAdder(bot, async (_bot, guildId, trackData) => {
  embedCalls.push([guildId, trackData]);
  return { success: true };
});

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(signedInAs(() => ({ id: "owner", username: "owner", guilds: [] })));
  app.locals.bot = bot;
  app.locals.lookup = lookup;
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
  server = await listenForFetch(app);
  base = baseUrl(server);
});

after(() => server.close());

// 응답이 없으면 기다리지 않고 실패한다(구 코드의 무응답 회귀를 행 대신 실패로)
const req = (method: string, urlPath: string, body?: unknown) => requestJson<Reply>(base, method, urlPath, body, { timeoutMs: 3000 });

function freshPlayer() {
  player = makePlayer();
  bot.players.set(GUILD_ID, player);
  resolverCalls.length = 0;
  embedCalls.length = 0;
  return player;
}

test("queue add: 비문자열 query(배열/객체/숫자)는 400 — 구 코드는 TypeError로 응답 없음", async () => {
  freshPlayer();
  for (const query of [["a", "b"], { q: "x" }, 42]) {
    const r = await req("POST", `/api/guilds/${GUILD_ID}/player/queue`, { query });
    assert.equal(r.status, 400, JSON.stringify(query));
  }
  assert.equal(resolverCalls.length, 0, "검증 실패 시 해석까지 가지 않음");
});

test("queue add: 길이 상한 초과는 400, 제어문자는 공백 정규화 후 전달", async () => {
  freshPlayer();
  const long = await req("POST", `/api/guilds/${GUILD_ID}/player/queue`, { query: "가".repeat(501) });
  assert.equal(long.status, 400);

  const r = await req("POST", `/api/guilds/${GUILD_ID}/player/queue`, { query: "hello\r\nworld\x00!" });
  assert.equal(r.status, 200);
  const sent = resolverCalls.at(-1) ?? "";
  assert.doesNotMatch(sent, /[\x00-\x1f\x7f]/, "제어문자가 yt-dlp/로그로 흘러가지 않음");
  assert.match(sent, /hello +world +!/);
  assert.equal(embedCalls.length, 1, "대시보드도 슬래시 명령과 같은 코어를 지난다");
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
  assert.deepEqual(player.calls[0], ["seek", 30000, "dashboard"]);
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

test("순번으로 빼기 · 옮기기 경로는 없다(줄 번호 경로만)", async () => {
  freshPlayer();
  assert.equal((await req("DELETE", `/api/guilds/${GUILD_ID}/player/queue/1`)).status, 404);
  assert.equal((await req("POST", `/api/guilds/${GUILD_ID}/player/queue/move`, { from: 0, to: 2 })).status, 404);
  assert.equal((await req("GET", `/api/guilds/${GUILD_ID}/player/events`)).status, 404, "서버 하나 연결도 없다(목록 연결 하나)");
  assert.equal(player.calls.length, 0);
});

test("받아들인 조작은 디스코드의 패널 채널에도 같은 화면으로 알린다. 누가 했나는 (대시보드)", async () => {
  freshPlayer();
  const sent: string[] = [];
  bot.panels = fake<BotContext["panels"]>({ ...panels, panelChannel: async () => ({ send: async (p: { components: Array<{ toJSON(): unknown }> }) => (sent.push(textsOf(p).join("\n")), { id: "m1", delete: async () => {} }) }) });
  try {
    const r = await req("POST", `/api/guilds/${GUILD_ID}/player/queue/move-entry`, { entry: 1, before: null });
    assert.equal(r.status, 200);
    await new Promise(setImmediate);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^### 🔀 곡의 순서를 옮겼어요\n\*\*\[q0\]/);
    assert.match(sent[0], /📍 기존 순번: 1번째\n📍 현재 순번: 3번째\n-# 👤 변경한 사람 <@owner> \(대시보드\)$/, "사람은 1부터 센다");

    const refused = await req("POST", `/api/guilds/${GUILD_ID}/player/queue/move-entry`, { entry: 1, before: 2 });
    assert.notEqual(refused.status, 200);
    await new Promise(setImmediate);
    assert.equal(sent.length, 1, "거절한 조작은 알리지 않는다");
  } finally {
    bot.panels = fake<BotContext["panels"]>(panels);
  }
});

test("하이라이트: 디스코드 /highlight 와 같은 조작이고, 패널 채널에도 하이라이트로 건너뛰었다고 알린다(위치를 옮겼다가 아니라)", async () => {
  const p = freshPlayer();
  Object.assign(p, { sponsor: { highlightAt: 42 } });
  const sent: string[] = [];
  bot.panels = fake<BotContext["panels"]>({ ...panels, panelChannel: async () => ({ send: async (m: { components: Array<{ toJSON(): unknown }> }) => (sent.push(textsOf(m).join("\n")), { id: "m1", delete: async () => {} }) }) });
  try {
    const r = await req("POST", `/api/guilds/${GUILD_ID}/player/highlight`);
    assert.equal(r.status, 200);
    await new Promise(setImmediate);
    assert.deepEqual(p.calls, [["seek", 42000, "highlight"]]);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^### ✨ 하이라이트로 건너 뛰었어요!/);

    Object.assign(p, { sponsor: null });
    const none = await req("POST", `/api/guilds/${GUILD_ID}/player/highlight`);
    assert.equal(none.status, 409);
    assert.equal((none.json as { code?: string }).code, "no-highlight");
  } finally {
    bot.panels = fake<BotContext["panels"]>(panels);
  }
});

// 화면이 받은 상태를 만든 차례로 가려 늦게 온 옛 응답이 새 상태를 덮지 않게 한다
type State = { boot: number; seq: number; playing: boolean; queue: unknown[]; queueTotal: number; currentTrack: unknown; canManage?: boolean };
const stateReq = (method: string, urlPath: string, body?: unknown) => requestJson<State>(base, method, urlPath, body, { timeoutMs: 3000 });

test("조작은 모두 같은 재생 상태로 답하고 만든 차례가 오른다. 정지 뒤에는 빈 상태", async () => {
  const p = freshPlayer();
  Object.assign(p, {
    paused: false,
    previousTracks: [makeTrack("전곡")],
    skip: () => true,
    previous: () => true,
    _restartsOnPrevious: () => false,
    pauseFor: () => true,
    resumeFor: () => true,
    hasLiveTrack: () => false,
    setLoop: (mode: Player["loop"]) => (p.loop = mode),
    shuffleQueue() {},
    _trackLabel: () => "현재곡",
    async dispose() {
      bot.players.delete(GUILD_ID);
    },
  });
  const steps: Array<[string, string, unknown?]> = [
    ["POST", "pause"],
    ["POST", "skip"],
    ["POST", "previous"],
    ["POST", "seek", { position: 10 }],
    ["POST", "volume", { volume: 60 }],
    ["POST", "loop", { mode: "track" }],
    ["POST", "shuffle"],
    ["POST", "queue/move-entry", { entry: 1, before: null }],
    ["DELETE", "queue/entry/1"],
    ["POST", "stop"],
  ];
  const seen: State[] = [];
  for (const [method, action, body] of steps) {
    const r = await stateReq(method, `/api/guilds/${GUILD_ID}/player/${action}`, body);
    assert.equal(r.status, 200, action);
    for (const key of ["boot", "seq", "playing", "queue", "queueTotal", "currentTrack"]) assert.ok(key in r.json, `${action}: ${key}`);
    seen.push(r.json);
  }
  assert.ok(
    seen.every((s, i) => i === 0 || (s.seq > seen[i - 1].seq && s.boot === seen[0].boot)),
    "만든 차례가 오르고 기동 표는 같다",
  );
  assert.equal(seen.at(-1)?.currentTrack, null, "정지 뒤에는 플레이어가 없다");
});

// 줄 번호를 단 곡(track-state 가 들어올 때 찍는 열거되지 않는 칸과 같게)
type Rows = { currentTrack: { entry: number | null } | null; queue: { title: string; entry: number | null }[] };
const rowsReq = (method: string, urlPath: string, body?: unknown) => requestJson<Rows & { code?: string }>(base, method, urlPath, body, { timeoutMs: 3000 });

test("줄 번호: 상태에 싣고, 빼기 · 옮기기는 그 줄을 가리킨다(보던 순번이 밀려도). 없으면 410, 잘못된 값은 400", async () => {
  const p = freshPlayer();
  Object.assign(p, { currentTrack: entered("현재곡", 10), queue: [entered("새 곡", 14), entered("q0", 11), entered("q1", 12), entered("q2", 13)] });
  Object.assign(p, {
    moveInQueue(from: number, to: number) {
      p.calls.push(["moveInQueue", from, to]);
      p.queue.splice(to, 0, p.queue.splice(from, 1)[0]);
    },
  });
  const state = await rowsReq("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.deepEqual([state.json.currentTrack?.entry, state.json.queue.map((t) => t.entry)], [10, [14, 11, 12, 13]]);

  const removed = await rowsReq("DELETE", `/api/guilds/${GUILD_ID}/player/queue/entry/12`);
  assert.equal(removed.status, 200);
  assert.deepEqual(
    removed.json.queue.map((t) => t.title),
    ["새 곡", "q0", "q2"],
  );
  assert.deepEqual([(await rowsReq("DELETE", `/api/guilds/${GUILD_ID}/player/queue/entry/12`)).json.code, (await rowsReq("DELETE", `/api/guilds/${GUILD_ID}/player/queue/entry/x`)).status], ["entry-gone", 400]);

  const moved = await rowsReq("POST", `/api/guilds/${GUILD_ID}/player/queue/move-entry`, { entry: 13, before: 14 });
  assert.deepEqual(
    moved.json.queue.map((t) => t.title),
    ["q2", "새 곡", "q0"],
  );
  const toEnd = await rowsReq("POST", `/api/guilds/${GUILD_ID}/player/queue/move-entry`, { entry: 13, before: null });
  assert.deepEqual(
    toEnd.json.queue.map((t) => t.title),
    ["새 곡", "q0", "q2"],
  );
  assert.equal((await rowsReq("POST", `/api/guilds/${GUILD_ID}/player/queue/move-entry`, { entry: 99, before: null })).status, 410);
  for (const body of [{ entry: 13 }, { entry: "13", before: null }, { entry: 1.5, before: null }, {}]) assert.equal((await rowsReq("POST", `/api/guilds/${GUILD_ID}/player/queue/move-entry`, body)).status, 400, JSON.stringify(body));
});

test("지금 곡 확인: 보던 곡(onTrack)이 지금 곡이 아니면 넘기기 · 이전 · 이동 · 하이라이트를 409 로 거절한다", async () => {
  const p = freshPlayer();
  Object.assign(p, { currentTrack: entered("현재곡", 10), sponsor: { highlightAt: 5 }, previousTracks: [makeTrack("전곡")], skip: () => (p.calls.push(["skip"]), true), previous: () => true, _restartsOnPrevious: () => false });
  for (const [action, body] of [
    ["skip", { onTrack: 9 }],
    ["previous", { onTrack: 9 }],
    ["seek", { position: 10, onTrack: 9 }],
    ["highlight", { onTrack: 9 }],
  ] as const) {
    const r = await rowsReq("POST", `/api/guilds/${GUILD_ID}/player/${action}`, body);
    assert.deepEqual([r.status, r.json.code], [409, "track-changed"], action);
  }
  assert.deepEqual(p.calls, [], "아무것도 하지 않았다");
  assert.equal((await rowsReq("POST", `/api/guilds/${GUILD_ID}/player/skip`, { onTrack: 10 })).status, 200);
  assert.equal((await rowsReq("POST", `/api/guilds/${GUILD_ID}/player/skip`, { onTrack: "10" })).status, 400);
});

test("?queue=0 이면 대기열 없이 답한다(곡 수는 그대로). 비우거나 모르는 값이면 기본 창", async () => {
  freshPlayer();
  const none = await stateReq("GET", `/api/guilds/${GUILD_ID}/player?queue=0`);
  assert.deepEqual([none.json.queue.length, none.json.queueTotal], [0, 3]);
  for (const qs of ["", "?queue=", "?queue=abc", "?queue=-1"]) assert.equal((await stateReq("GET", `/api/guilds/${GUILD_ID}/player${qs}`)).json.queue.length, 3, qs);
});

test("queue/more: 목록 정보가 깨졌거나 곡 수가 범위 밖이면 400, 본문의 맨 앞 넣기는 무시한다", async () => {
  freshPlayer();
  const state = { kind: "spp", listId: "37i9dQZF1E3aglU7q0y10F", offset: 50, anchorId: `c${String(49).padStart(21, "0")}` };
  for (const body of [
    { ...state, kind: "xx", count: 10 },
    { ...state, listId: "../../x", count: 10 },
    { ...state, count: 0 },
    { ...state, count: "10" },
    { ...state, count: 10.5 },
  ]) {
    const r = await req("POST", `/api/guilds/${GUILD_ID}/player/queue/more`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(embedCalls.length, 0);

  const ok = await req("POST", `/api/guilds/${GUILD_ID}/player/queue/more`, { ...state, count: 10, insertFirst: true });
  assert.equal(ok.status, 200);
  assert.equal(embedCalls.at(-1)?.[1].tracks.length, 10);
  assert.equal(embedCalls.at(-1)?.[1].insertAfterId, undefined, "대시보드는 맨 앞에 넣는 경로가 없다");
  assert.equal(ok.json.more?.offset, 60);
  assert.equal(ok.json.more?.requesterId, undefined);
});

test("조작 거절은 디스코드와 같은 코드의 문제 응답으로 보낸다(문장은 클라이언트가 코드로 만든다)", async () => {
  freshPlayer().currentTrack = null;
  const r = await req("POST", `/api/guilds/${GUILD_ID}/player/pause`);
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { type: "/problems/no-song", code: "no-song", status: 409, title: "Nothing is playing" });
});

test("볼륨 · 곡 빼기를 바꾸면 디스코드 패널도 고친다(볼륨은 잇단 변경이 멈춘 뒤)", async () => {
  const seen: boolean[] = [];
  const off = playerEvents.on("refresh", async (p: Player) => p === player && seen.push(true)); // 앞 테스트의 음량 타이머가 늦게 올 수 있다
  try {
    freshPlayer();
    await req("POST", `/api/guilds/${GUILD_ID}/player/volume`, { volume: 30 });
    await req("DELETE", `/api/guilds/${GUILD_ID}/player/queue/entry/1`);
    await new Promise((done) => setTimeout(done, VOLUME_SETTLE_MS + 50));
  } finally {
    off();
  }
  assert.deepEqual(seen, [true, true]);
});

test("본문 없는 요청은 400 으로 답한다(본문을 읽다 던지지 않는다)", async () => {
  // Content-Type 없이 본문도 없으면 Express 5 는 req.body 를 비워 둔다
  for (const [action, code] of [
    ["seek", "bad-time"],
    ["volume", "bad-volume"],
    ["loop", "bad-loop-mode"],
    ["queue/move-entry", "bad-request"],
  ]) {
    freshPlayer();
    const r = await fetch(`${base}/api/guilds/${GUILD_ID}/player/${action}`, { method: "POST", signal: AbortSignal.timeout(3000) });
    assert.equal(r.status, 400, action);
    assert.equal(((await r.json()) as { code: string }).code, code, action);
    assert.equal(player.calls.length, 0, action);
  }
});
