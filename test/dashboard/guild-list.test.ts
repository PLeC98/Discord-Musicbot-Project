// src/dashboard/routes/guild-list.ts — 서버 목록: 지금 멤버인 서버만, 서버마다 상태와 지금 곡

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { AudioPlayerStatus } from "@discordjs/voice";
import { fakeBot, fakePlayer } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import type { GuildList } from "../../src/dashboard/contract/guilds.ts";
import type { Player } from "../../src/player/player.ts";

const { createGuildListRouter } = await import("../../src/dashboard/routes/guild-list.ts");

/** 서버 하나. members: 멤버인 사용자 ID */
function guild(id: string, members: string[]) {
  return {
    id,
    name: `서버 ${id}`,
    icon: null,
    memberCount: 10,
    voiceStates: { cache: new Map() },
    members: {
      me: null,
      fetch: async (userId: string) => {
        if (!members.includes(userId)) throw new Error("Unknown Member");
        return { permissions: { has: () => false } };
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

let user: object | null = { id: "u1", username: "사용자" };
const app = express();
app.use(signedInAs(() => user));
app.locals.bot = fakeBot({ client: { isReady: () => true, guilds: { cache: guilds } }, players });
app.use("/api/guilds", createGuildListRouter());
const server = await listenForFetch(app);
after(() => server.close());
const list = async () => (await requestJson<GuildList>(baseUrl(server), "GET", "/api/guilds")).json.guilds;

test("멤버인 서버만, 서버 ID 차례로", async () => {
  user = { id: "u1", username: "사용자" };
  assert.deepEqual(
    (await list()).map((g) => g.id),
    ["100", "300"],
  );
});

test("운영자도 멤버인 서버만(참가하지 않은 서버는 보이지 않는다)", async () => {
  user = { id: "owner", username: "운영자" };
  assert.deepEqual(await list(), []);
  user = { id: "u1", username: "사용자" };
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
