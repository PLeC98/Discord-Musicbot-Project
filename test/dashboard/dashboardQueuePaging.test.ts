// dashboard/server/routes/guilds.js — 대기열을 구간으로 나눠 싣는 경로.
// 큐 전체를 매 응답에 담던 것을 바꿨다. 조작 응답도 상태를 통째로 돌려주므로,
// 화면이 펼쳐 둔 창(?queue=n)을 그대로 지켜주지 않으면 목록이 접힌다.

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const { openTempStore } = await import("../helpers/tempStore.ts");
const { createGuildsRouter } = await import("../../dashboard/server/routes/guilds.ts");
const { createPlayerStream } = await import("../../dashboard/server/playerStream.ts");
const store = openTempStore("queue-paging-");
after(() => store.close());

import express from "express";
import type { Server } from "node:http";
import type { Client } from "discord.js";
import type { MusicPlayer } from "../../src/player/Player.ts";
import type { playerState, queueTrack } from "../../dashboard/server/playerView.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";

type PlayerReply = ReturnType<typeof playerState>;
type QueueReply = { items: ReturnType<typeof queueTrack>[]; total: number };

const GUILD_ID = "100";
const QUEUE_LEN = 257;
const PAGE = 100; // guilds.js QUEUE_PAGE

function makeTrack(title: string) {
  return { title, artist: "a", duration: 300, thumbnail: null, url: "u", platform: "youtube", requestedBy: null };
}

function makePlayer() {
  return fakePlayer({
    currentTrack: makeTrack("현재곡"),
    queue: Array.from({ length: QUEUE_LEN }, (_, i) => makeTrack(`q${i}`)),
    previousTracks: [],
    getStatus: () => ({ playing: true, paused: false, volume: 50, loop: false }),
    isPlaybackActive: () => true,
    getCurrentTime: () => 0,
    removeFromQueue(i: number) {
      return this.queue.splice(i, 1)[0];
    },
  });
}

let player: MusicPlayer;
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: new Map() },
  channels: { cache: new Map() },
  members: {
    fetch: async () => {
      throw new Error("Unknown Member");
    },
    me: null,
  },
};
const client = {
  isReady: () => true,
  guilds: { cache: new Map([[GUILD_ID, guild]]) },
  players: new Map<string, MusicPlayer>(),
  musicEmbedManager: { updateNowPlayingEmbed: async () => {} },
};

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(signedInAs(() => ({ id: "owner", username: "owner", guilds: [] })));
  app.locals.discordClient = fake<Client>(client);
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
  server = await listenForFetch(app);
  base = baseUrl(server);
  player = makePlayer();
  client.players.set(GUILD_ID, player);
});

after(() => server.close());

const get = <T = PlayerReply>(urlPath: string, method = "GET") => requestJson<T>(base, method, urlPath, undefined, { timeoutMs: 3000 });

test("기본 응답은 한 묶음만 싣고 총 개수를 따로 알린다", async () => {
  const { status, json } = await get(`/api/guilds/${GUILD_ID}/player`);
  assert.equal(status, 200);
  assert.equal(json.queue.length, PAGE);
  assert.equal(json.queueTotal, QUEUE_LEN);
  assert.equal(json.queue[0].index, 0);
  // 툴팁에 "youtube" 대신 읽을 수 있는 이름이 뜬다 — 브라우저는 src/platforms 를 못 읽어 서버가 실어 준다
  assert.equal(json.queue[0].platformLabel, "YouTube");
});

test("?queue=n이면 펼쳐 둔 만큼 돌려준다 — 조작 응답도 같다", async () => {
  const { json } = await get(`/api/guilds/${GUILD_ID}/player?queue=150`);
  assert.equal(json.queue.length, 150);

  const removed = await get(`/api/guilds/${GUILD_ID}/player/queue/0?queue=150`, "DELETE");
  assert.equal(removed.status, 200);
  assert.equal(removed.json.queue.length, 150, "조작 응답이 첫 묶음으로 접히면 화면이 되감긴다");
  assert.equal(removed.json.queueTotal, QUEUE_LEN - 1);
});

test("창 크기는 상한을 넘지 못하고, 이상한 값은 기본값으로 떨어진다", async () => {
  const huge = await get(`/api/guilds/${GUILD_ID}/player?queue=999999`);
  assert.equal(huge.json.queue.length, huge.json.queueTotal, "상한(1000)이 큐보다 크므로 전부");

  for (const bad of ["0", "-5", "abc", "1.5"]) {
    const { json } = await get(`/api/guilds/${GUILD_ID}/player?queue=${bad}`);
    assert.equal(json.queue.length, PAGE, `?queue=${bad}`);
  }
});

test("더 보기는 이어지는 구간을 실제 위치와 함께 준다", async () => {
  const { status, json } = await get<QueueReply>(`/api/guilds/${GUILD_ID}/player/queue?offset=100&limit=100`);
  assert.equal(status, 200);
  assert.equal(json.items.length, 100);
  assert.equal(json.items[0].index, 100, "화면이 이 번호로 제거·이동을 요청한다");
  assert.equal(json.total, QUEUE_LEN - 1);

  const tail = await get<QueueReply>(`/api/guilds/${GUILD_ID}/player/queue?offset=200&limit=100`);
  assert.equal(tail.json.items.length, QUEUE_LEN - 1 - 200, "끝을 넘겨 요청해도 있는 만큼만");
});

test("더 보기의 잘못된 범위는 400", async () => {
  for (const q of ["offset=-1&limit=10", "offset=0&limit=0", "offset=0&limit=99999", "offset=abc&limit=10"]) {
    const { status } = await get(`/api/guilds/${GUILD_ID}/player/queue?${q}`);
    assert.equal(status, 400, q);
  }
});
