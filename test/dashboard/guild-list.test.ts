// src/dashboard/routes/guild-list.ts: 서버 목록. 지금 멤버인 서버만, 서버마다 상태와 지금 곡.
// 사용자가 든 서버(사용자의 서버 목록)만 멤버 판정을 하고, 목록을 받지 못하면 이미 확인한 서버만 보이며 재로그인 안내를 싣는다

process.env.OWNER_ID = "owner";

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { AudioPlayerStatus } from "@discordjs/voice";
import { fakeBot, fakePlayer } from "../helpers/fake.ts";
import { requestJson } from "../helpers/dashboard.ts";
import { userGuildsFixture } from "../helpers/user-guilds.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import type { GuildList } from "../../src/dashboard/contract/guilds.ts";
import type { Player } from "../../src/player/player.ts";

const { createGuildListRouter } = await import("../../src/dashboard/routes/guild-list.ts");

/** 서버 하나. members: 멤버인 사용자 ID. 가져오면 캐시에 남는다(캐시에 있으면 조회하지 않는다). asked: 디스코드에 조회한 사용자 */
function guild(id: string, members: string[]) {
  const cache = new Map<string, object>();
  const asked: string[] = [];
  return {
    id,
    name: `서버 ${id}`,
    icon: null,
    memberCount: 10,
    available: true,
    asked,
    voiceStates: { cache: new Map() },
    members: {
      me: null,
      cache,
      fetch: async (userId: string) => {
        const hit = cache.get(userId);
        if (hit) return hit;
        asked.push(userId);
        if (!members.includes(userId)) throw new Error("Unknown Member");
        const member = { permissions: { has: () => false } };
        cache.set(userId, member);
        return member;
      },
    },
  };
}

const guilds = new Map([
  ["300", guild("300", ["u1"])],
  ["100", guild("100", ["u1"])],
  ["200", guild("200", [])],
]);
const players = new Map<string, Player>();
const track = { title: "곡", artist: "가수", thumbnail: "https://img/1.jpg", duration: 200, platform: "youtube" };

const tokens = userGuildsFixture();
let user = { id: "u1", username: "사용자" };
const app = express();
app.use(tokens.middleware(() => user));
app.locals.bot = fakeBot({ client: { isReady: () => true, guilds: { cache: guilds } }, players });
app.use("/api/guilds", createGuildListRouter({ http: tokens.http }));
const server = await listenForFetch(app);
after(() => {
  server.close();
  tokens.close();
});
const get = async () => (await requestJson<GuildList>(baseUrl(server), "GET", "/api/guilds")).json;
const list = async () => (await get()).guilds;

beforeEach(() => {
  tokens.reset();
  for (const g of guilds.values()) {
    g.members.cache.clear();
    g.asked.length = 0;
  }
  // 디스코드의 답: u1 은 100 · 200 · 300 에 들었다(200 은 그 뒤 나갔다: 봇의 멤버 판정이 막는다)
  tokens.state.guilds.set("u1", ["100", "200", "300", "elsewhere"]);
  tokens.state.guilds.set("owner", []);
  tokens.signIn("u1");
  tokens.signIn("owner");
  user = { id: "u1", username: "사용자" };
});

test("멤버인 서버만, 서버 ID 순서로", async () => {
  user = { id: "u1", username: "사용자" };
  assert.deepEqual(
    (await list()).map((g) => g.id),
    ["100", "300"],
  );
});

test("운영자도 멤버인 서버만(참가하지 않은 서버는 보이지 않는다)", async () => {
  user = { id: "owner", username: "운영자" };
  assert.deepEqual(await list(), []);
});

test("사용자의 서버 목록에 없는 서버는 멤버 판정을 하지 않는다", async () => {
  tokens.state.guilds.set("u1", ["100"]);
  assert.deepEqual(
    (await list()).map((g) => g.id),
    ["100"],
  );
  assert.deepEqual([guilds.get("200")?.asked, guilds.get("300")?.asked], [[], []]);
});

test("서버 목록을 받지 못하면(토큰 없음 · 401) 이미 확인한 서버만 보이고 재로그인 안내를 싣는다. 봇이 든 서버마다 묻지 않는다", async () => {
  guilds.get("100")?.members.cache.set("u2", { permissions: { has: () => false } });
  user = { id: "u2", username: "토큰 없음" };
  tokens.signIn("u2", { token: false });
  const noToken = await get();
  assert.deepEqual(
    noToken.guilds.map((g) => g.id),
    ["100"],
  );
  assert.equal(noToken.relogin, true);
  assert.deepEqual(
    [...guilds.values()].flatMap((g) => g.asked),
    [],
  );

  user = { id: "u1", username: "사용자" };
  tokens.state.failWith = 401;
  assert.equal((await get()).relogin, true);
  await get();
  assert.equal(tokens.state.asked.length, 1, "401 을 받은 세션은 다시 로그인할 때까지 묻지 않는다");
});

test("목록을 받았으면 재로그인 안내가 없다", async () => {
  assert.equal((await get()).relogin, undefined);
});

test("지금 곡: 소리가 붙어 있을 때만 제목 · 가수 · 그림, 그 밖은 null", async () => {
  players.clear();
  players.set("100", fakePlayer({ currentTrack: track, audioPlayer: { state: { status: AudioPlayerStatus.Playing } } }));
  // 곡을 여는 중(소리가 아직 없다)
  players.set("300", fakePlayer({ currentTrack: track, audioPlayer: { state: { status: AudioPlayerStatus.Idle } } }));
  const rows = await list();
  assert.deepEqual(rows.find((g) => g.id === "100")?.nowPlaying, { title: "곡", artist: "가수", thumbnail: "https://img/1.jpg" });
  assert.equal(rows.find((g) => g.id === "300")?.nowPlaying, null);

  players.clear();
  assert.ok(
    (await list()).every((g) => g.nowPlaying === null),
    "플레이어가 없으면 null",
  );
});
