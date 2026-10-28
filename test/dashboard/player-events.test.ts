// src/dashboard/routes/player-events.ts — 서버 목록의 재생 상태 알림(SSE)을 누가 어느 서버로 받는가.
//
// 지키려는 계약: 지금 멤버인 서버의 신호만 받는다. 로그인할 때 받은 서버 목록이나 연결을 연 때의 집합에 기대면,
// 그 뒤 나간 서버의 재생 상태가 계속 흘러가거나 그 뒤 들어간 서버의 신호가 빠진다. 운영자도 같다(참가한 서버만).
// 보기 권한 확인은 보낼 때 멤버 캐시로 한다. 그래서 연결을 열 때 사용자가 든 서버(사용자의 서버 목록)만 캐시를 채우고,
// 봇이 새 서버에 들 때도 채운다. 목록을 받지 못하면 이미 확인한 서버만(봇이 든 서버마다 묻지 않는다). 사용 불가(unavailable) 서버는 보이지 않는다.

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { createPlayerEventsRouter, botJoinedGuild, guildBack } = await import("../../src/dashboard/routes/player-events.ts");
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Response } from "express";
import type { Server } from "node:http";
import type { PlayerStream } from "../../src/dashboard/player-stream.ts";
import { fake, fakeBot } from "../helpers/fake.ts";
import { requestJson } from "../helpers/dashboard.ts";
import { userGuildsFixture } from "../helpers/user-guilds.ts";

// 서버 하나. member 면 가져오기가 되고, 가져오면 진짜처럼 캐시에 남는다(캐시에 있으면 묻지 않고, force 면 묻는다). fetched: 디스코드에 물은 사용자
const guild = (id: string, member: boolean) => {
  const cache = new Map<string, object>();
  const fetched: string[] = [];
  return {
    id,
    available: true,
    fetched,
    members: {
      cache,
      fetch: async (options: string | { user: string }) => {
        const userId = typeof options === "string" ? options : options.user;
        const hit = cache.get(userId);
        if (hit && typeof options === "string") return hit;
        fetched.push(userId);
        if (!member) throw new Error("Unknown Member");
        cache.set(userId, { id: userId });
        return { id: userId };
      },
    },
  };
};
type FakeGuild = ReturnType<typeof guild>;
let ready = true;
const guilds = new Map<string, FakeGuild>();
const client = { isReady: () => ready, guilds: { cache: guilds } };

// 구독을 받으면 보기 권한 확인(canSee) · 멤버로 확인한 서버(guilds)를 적어 두고 연결을 닫는다. full 이면 상한에 찼다
const subscribed: Array<{ canSee: (guildId: string) => boolean; userId: string; guilds: Set<string> }> = [];
const nudged: string[] = [];
let full = false;
const stream = fake<PlayerStream>({
  atCap: () => full,
  addClient: (res: Response, canSee: (guildId: string) => boolean, userId: string, guilds: Set<string>) => {
    subscribed.push({ canSee, userId, guilds });
    res.end();
  },
  listUsers: () => new Set(subscribed.map((s) => s.userId)),
  watching: (guildId: string) => new Set(subscribed.filter((s) => s.guilds.has(guildId)).map((s) => s.userId)),
  watch: (userId: string, guildId: string) => subscribed.filter((s) => s.userId === userId).forEach((s) => s.guilds.add(guildId)),
  notify: (guildId: string) => nudged.push(guildId),
});

const tokens = userGuildsFixture();
let user = { id: "u1", username: "u" };
let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(tokens.middleware(() => user));
  app.locals.bot = fakeBot({ client });
  app.use("/api/guilds", createPlayerEventsRouter({ stream, http: tokens.http }));
  server = await listenForFetch(app);
  base = baseUrl(server);
});
after(() => {
  server.close();
  tokens.close();
});

beforeEach(() => {
  tokens.reset();
  subscribed.length = 0;
  nudged.length = 0;
  user = { id: "u1", username: "u" };
  guilds.clear();
  guilds.set("g1", guild("g1", true));
  guilds.set("g2", guild("g2", false));
  tokens.state.guilds.set("u1", ["g1", "elsewhere"]);
  tokens.state.guilds.set("owner", []);
  tokens.signIn("u1");
  tokens.signIn("owner");
});

const visible = (canSee: (guildId: string) => boolean, ids: string[]) => ids.filter((id) => canSee(id));
const open = () => requestJson(base, "GET", "/api/guilds/events");

test("사용자가 든 서버만 가져와 보인다. 든 적 없는 서버 · 봇이 없는 서버는 묻지도 않는다", async () => {
  const { status } = await open();
  assert.equal(status, 200);
  assert.equal(subscribed[0].userId, "u1");
  assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g2", "gone"]), ["g1"]);
  assert.deepEqual(guilds.get("g2")?.fetched, [], "서버 목록에 없는 서버는 멤버 조회를 하지 않는다");
});

test("연결을 연 뒤 봇이 새 서버에 들면, 연결을 연 사람을 그 서버에서 가져와 보이게 하고 목록에 알린다", async () => {
  await open();
  const g3 = guild("g3", true);
  guilds.set("g3", g3);
  assert.deepEqual(visible(subscribed[0].canSee, ["g3"]), [], "새 서버의 캐시에는 아직 없다(음성 채널에 없는 사람)");
  await botJoinedGuild(stream, fake<Parameters<typeof botJoinedGuild>[1]>(g3));
  assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g3"]), ["g1", "g3"]);
  assert.deepEqual(nudged, ["g3"]);
});

test("운영자도 참가한 서버만", async () => {
  user = { id: "owner", username: "o" };
  await open();
  assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g2"]), []);
});

test("서버 목록을 받지 못하면(토큰 없음 · 거절) 이미 확인한 서버만 보이고, 봇이 든 서버마다 묻지 않는다", async () => {
  user = { id: "u2", username: "토큰 없음" };
  guilds.get("g1")?.members.cache.set("u2", { id: "u2" });
  tokens.signIn("u2", { token: false });
  await open();
  assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g2"]), ["g1"], "캐시에 있던 서버는 보인다");
  assert.deepEqual(
    [...guilds.values()].flatMap((g) => g.fetched),
    [],
    "멤버 조회가 나가지 않는다",
  );

  subscribed.length = 0;
  user = { id: "u1", username: "u" };
  guilds.get("g1")?.members.cache.set("u1", { id: "u1" });
  tokens.state.failWith = 401;
  await open();
  await open();
  assert.deepEqual(visible(subscribed[0].canSee, ["g1", "g2"]), ["g1"]);
  assert.equal(tokens.state.asked.length, 1, "401 을 받은 세션은 다시 로그인할 때까지 묻지 않는다");
});

test("사용 불가 서버(재연결 직후)는 캐시에 있어도 보이지 않는다", async () => {
  await open();
  const g1 = guilds.get("g1");
  assert.ok(g1);
  g1.available = false;
  assert.deepEqual(visible(subscribed[0].canSee, ["g1"]), []);
  g1.available = true;
  assert.deepEqual(visible(subscribed[0].canSee, ["g1"]), ["g1"]);
});

test("상한에 찼으면 멤버 확인(REST) 없이 막는다", async () => {
  full = true;
  try {
    const { status } = await open();
    assert.equal(status, 429);
    assert.equal(subscribed.length, 0);
    assert.deepEqual([tokens.state.asked, guilds.get("g1")?.fetched], [[], []]);
  } finally {
    full = false;
  }
});

test("연결은 멤버로 확인한 서버를 든다. 새 서버에서 확인되면 더한다", async () => {
  await open();
  assert.deepEqual([...subscribed[0].guilds], ["g1"]);
  const g3 = guild("g3", true);
  guilds.set("g3", g3);
  await botJoinedGuild(stream, fake<Parameters<typeof botJoinedGuild>[1]>(g3));
  assert.deepEqual([...subscribed[0].guilds].sort(), ["g1", "g3"]);
});

test("게이트웨이에 재연결해 사용 불가 서버가 다시 사용 가능해지면, 그 서버를 보던 연결의 사람만 다시 가져와 보이게 하고 알린다", async () => {
  await open();
  user = { id: "owner", username: "o" };
  await open();
  const g1 = guilds.get("g1");
  assert.ok(g1);
  // discord.js 가 GUILD_CREATE 에서 멤버 캐시를 비우고 봇 · 음성 채널 사람만 채운다
  g1.members.cache.clear();
  g1.fetched.length = 0;
  assert.deepEqual(visible(subscribed[0].canSee, ["g1"]), [], "비운 캐시로는 보이지 않는다");
  await guildBack(stream, fake<Parameters<typeof guildBack>[1]>(g1));
  assert.deepEqual(visible(subscribed[0].canSee, ["g1"]), ["g1"]);
  assert.deepEqual(g1.fetched, ["u1"], "그 서버를 보던 사람만 묻는다(운영자 연결은 g1 을 보지 않았다)");
  assert.deepEqual(nudged, ["g1"]);
});

test("봇이 준비되기 전이면 구독하지 않고 503", async () => {
  ready = false;
  try {
    const { status } = await open();
    assert.equal(status, 503);
    assert.equal(subscribed.length, 0);
  } finally {
    ready = true;
  }
});
