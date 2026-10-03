// src/dashboard/routes/player-events.ts — 서버 목록의 재생 상태 알림(SSE)을 누가 어느 서버로 받는가.
//
// 지키려는 계약: 지금 멤버인 서버의 신호만 받는다. 로그인할 때 받은 서버 목록이나 연결을 연 때의 집합에 기대면,
// 그 뒤 나간 서버의 재생 상태가 계속 흘러가거나 그 뒤 들어간 서버의 신호가 빠진다. 운영자는 봇이 있는 서버 전부.
// 볼 수 있는지는 보낼 때 멤버 캐시로 묻는다. 그래서 연결을 열 때와 봇이 새 서버에 들 때 캐시를 채운다.

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { createPlayerEventsRouter, botJoinedGuild } = await import("../../src/dashboard/routes/player-events.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Response } from "express";
import type { Server } from "node:http";
import type { PlayerStream } from "../../src/dashboard/player-stream.ts";
import { fake, fakeBot } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";

// 서버 하나. member 면 가져오기가 되고, 가져오면 진짜처럼 캐시에 남는다
const guild = (id: string, member: boolean) => {
  const cache = new Map<string, object>();
  return {
    id,
    members: {
      cache,
      fetch: async (userId: string) => {
        if (!member) throw new Error("Unknown Member");
        cache.set(userId, { id: userId });
        return { id: userId };
      },
    },
  };
};
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

// 구독을 받으면 볼 수 있는가(canSee)를 적어 두고 연결을 닫는다
const subscribed: Array<{ canSee: (guildId: string) => boolean; userId: string }> = [];
const nudged: string[] = [];
const stream = fake<PlayerStream>({
  addListClient: (res: Response, canSee: (guildId: string) => boolean, userId: string) => {
    subscribed.push({ canSee, userId });
    res.end();
  },
  listUsers: () => new Set(subscribed.map((s) => s.userId)),
  notify: (guildId: string) => nudged.push(guildId),
});

let user = { id: "u1", username: "u", guilds: [{ id: "g1" }, { id: "g2" }, { id: "gone" }] };
let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(signedInAs(() => user));
  app.locals.bot = fakeBot({ client });
  app.use("/api/guilds", createPlayerEventsRouter({ stream }));
  server = await listenForFetch(app);
  base = baseUrl(server);
});
after(() => server.close());

const visible = (canSee: (guildId: string) => boolean, ids: string[]) => ids.filter((id) => canSee(id));

test("멤버인 서버만 보인다. 봇이 없는 서버도 빠진다", async () => {
  subscribed.length = 0;
  const { status } = await requestJson(base, "GET", "/api/guilds/events");
  assert.equal(status, 200);
  assert.equal(subscribed[0].userId, "u1");
  assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g2", "gone"]), ["g1"], "g2 는 멤버가 아니고 gone 은 봇이 없다");
});

test("연결을 연 뒤 봇이 새 서버에 들면, 연결을 연 사람을 그 서버에서 가져와 보이게 하고 목록에 알린다", async () => {
  subscribed.length = 0;
  nudged.length = 0;
  await requestJson(base, "GET", "/api/guilds/events");
  const g3 = guild("g3", true);
  client.guilds.cache.set("g3", g3);
  try {
    assert.deepEqual(visible(subscribed[0].canSee, ["g3"]), [], "새 서버의 캐시에는 아직 없다(음성 채널에 없는 사람)");
    await botJoinedGuild(stream, g3);
    assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g3"]), ["g1", "g3"]);
    assert.deepEqual(nudged, ["g3"]);
  } finally {
    client.guilds.cache.delete("g3");
  }
});

test("운영자는 확인 없이 봇이 있는 서버 전부", async () => {
  subscribed.length = 0;
  user = { id: "owner", username: "o", guilds: [] };
  try {
    await requestJson(base, "GET", "/api/guilds/events");
    assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g2"]), ["g1", "g2"]);
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
