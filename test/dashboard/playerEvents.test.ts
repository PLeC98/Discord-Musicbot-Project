// dashboard/server/routes/playerEvents.ts — 서버 목록의 재생 상태 알림(SSE)을 누가 어느 서버로 받는가.
//
// 지키려는 계약: 멤버임이 확인된 서버만 구독한다. 로그인할 때 받은 서버 목록만 믿으면, 그 뒤 나간 서버의
// 재생 상태가 계속 흘러간다. 운영자는 확인 없이 봇이 있는 서버 전부.

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { createPlayerEventsRouter } = await import("../../dashboard/server/routes/playerEvents.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Response } from "express";
import type { Server } from "node:http";
import type { Client } from "discord.js";
import type { PlayerStream } from "../../dashboard/server/playerStream.ts";
import { fake } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";

// 멤버 확인이 되는 서버와 안 되는 서버
const guild = (id: string, member: boolean) => ({
  id,
  members: {
    fetch: async () => {
      if (!member) throw new Error("Unknown Member");
      return { id: "u1" };
    },
  },
});
let ready = true;
const client = {
  isReady: () => ready,
  guilds: {
    cache: new Map([
      ["g1", guild("g1", true)],
      ["g2", guild("g2", false)],
    ]),
  },
};

// 구독을 받으면 서버 목록만 적어 두고 연결을 닫는다
const subscribed: Array<{ guildIds: string[]; userId: string }> = [];
const stream = fake<PlayerStream>({
  addListClient: (res: Response, guildIds: Set<string>, userId: string) => {
    subscribed.push({ guildIds: [...guildIds].sort(), userId });
    res.end();
  },
});

let user = { id: "u1", username: "u", guilds: [{ id: "g1" }, { id: "g2" }, { id: "gone" }] };
let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(signedInAs(() => user));
  app.locals.discordClient = fake<Client>(client);
  app.use("/api/guilds", createPlayerEventsRouter({ stream }));
  server = await listenForFetch(app);
  base = baseUrl(server);
});
after(() => server.close());

test("멤버임이 확인된 서버만 구독한다. 봇이 없는 서버도 빠진다", async () => {
  subscribed.length = 0;
  const { status } = await requestJson(base, "GET", "/api/guilds/events");
  assert.equal(status, 200);
  assert.deepEqual(subscribed, [{ guildIds: ["g1"], userId: "u1" }], "g2 는 멤버가 아니고 gone 은 봇이 없다");
});

test("운영자는 확인 없이 봇이 있는 서버 전부", async () => {
  subscribed.length = 0;
  user = { id: "owner", username: "o", guilds: [{ id: "g1" }, { id: "g2" }, { id: "gone" }] };
  try {
    await requestJson(base, "GET", "/api/guilds/events");
    assert.deepEqual(subscribed, [{ guildIds: ["g1", "g2"], userId: "owner" }]);
  } finally {
    user = { id: "u1", username: "u", guilds: [{ id: "g1" }, { id: "g2" }, { id: "gone" }] };
  }
});

test("봇이 준비되기 전이면 구독하지 않고 503", async () => {
  subscribed.length = 0;
  ready = false;
  try {
    const { status } = await requestJson(base, "GET", "/api/guilds/events");
    assert.equal(status, 503);
    assert.equal(subscribed.length, 0);
  } finally {
    ready = true;
  }
});
