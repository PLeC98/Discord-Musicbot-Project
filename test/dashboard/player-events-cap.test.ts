// src/dashboard/routes/player-events.ts와 player-stream의 슬롯 잡기: 연결 상한 슬롯은 멤버 확인(디스코드 조회) 전에 잡고 조회가 끝날 때까지 유지한다.
// 한꺼번에 열거나 열고 끊기를 되풀이해도 끝나지 않은 조회가 상한을 넘지 않는다. 진짜 PlayerStream과 조회를 막아 둔 가짜 서버를 쓴다

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { createPlayerEventsRouter } = await import("../../src/dashboard/routes/player-events.ts");
const { PlayerStream } = await import("../../src/dashboard/player-stream.ts");
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fakeBot } from "../helpers/fake.ts";
import { userGuildsFixture } from "../helpers/user-guilds.ts";

const MAX = 5;
// 멤버 조회를 풀어 줄 때까지 막아 두는 서버. fetched: 나간 조회 수
let open: () => void = () => {};
let gate = new Promise<void>((done) => (open = done));
const g1 = {
  id: "g1",
  available: true,
  fetched: 0,
  members: {
    cache: new Map<string, object>(),
    fetch: async (options: string | { user: string }) => {
      g1.fetched++;
      await gate;
      const id = typeof options === "string" ? options : options.user;
      return { id };
    },
  },
};
const client = { isReady: () => true, guilds: { cache: new Map([["g1", g1]]) } };
const stream = new PlayerStream({ heartbeatMs: 60_000, maxPerUser: MAX, coalesceMs: 10 });
const tokens = userGuildsFixture();
tokens.state.guilds.set("u1", ["g1"]);
tokens.signIn("u1");

const app = express();
app.use(tokens.middleware(() => ({ id: "u1", username: "u" })));
app.locals.bot = fakeBot({ client });
app.use("/api/guilds", createPlayerEventsRouter({ stream, http: tokens.http }));
const server = await listenForFetch(app);
const base = baseUrl(server);
after(() => {
  open();
  stream.close();
  server.closeAllConnections();
  server.close();
  tokens.close();
});

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));
// 연결을 열고 응답 상태 코드(429는 곧바로 온다)와 연결 끊기 함수를 돌려준다
function connect() {
  const controller = new AbortController();
  const status = fetch(`${base}/api/guilds/events`, { signal: controller.signal }).then(
    (res) => res.status,
    () => 0,
  );
  return { status, abort: () => controller.abort() };
}

test("한꺼번에 열어도, 열고 끊기를 되풀이해도 끝나지 않은 멤버 조회는 상한까지만. 조회가 끝나면 슬롯이 한 번씩 풀린다", async () => {
  const first = Array.from({ length: 2 * MAX }, connect);
  await settle(200);
  assert.equal(g1.fetched, MAX, "상한만큼만 조회가 나갔다");
  assert.equal((await Promise.all(first.slice(MAX).map((one) => one.status))).filter((s) => s === 429).length, MAX, "나머지는 곧바로 거절");

  // 기다리는 연결을 끊고 다시 연다: 조회가 끝나지 않았으니 슬롯은 그대로 쥐고 있다
  for (const one of first.slice(0, MAX)) one.abort();
  const again = Array.from({ length: MAX }, connect);
  assert.deepEqual(await Promise.all(again.map((one) => one.status)), Array(MAX).fill(429));
  assert.equal(g1.fetched, MAX, "끊고 다시 열어도 조회가 늘지 않는다");

  // 조회를 풀면 끊긴 연결은 열지 않고 슬롯을 푼다
  open();
  await settle(200);
  assert.equal(stream.perKey.get("u1"), undefined, "슬롯이 모두 풀렸다");
  gate = new Promise<void>((done) => (open = done));
  open();
  const fresh = connect();
  await settle(200);
  assert.equal(stream.perKey.get("u1"), 1, "다시 열 수 있다");
  fresh.abort();
});

test("Connection: close로 연다(세션이 끝나 끊을 때 그 소켓을 강제로 닫으므로 다시 쓰지 않게)", async () => {
  gate = new Promise<void>((done) => (open = done));
  open();
  const controller = new AbortController();
  const res = await fetch(`${base}/api/guilds/events`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("connection"), "close");
  controller.abort();
  await settle(50);
});

test("멤버 조회를 기다리는 사이 세션이 끝나면(다른 기기에서 끊음) 열지 않고 401, 슬롯을 푼다", async () => {
  gate = new Promise<void>((done) => (open = done));
  const one = connect();
  await settle(100);
  tokens.store.destroy("sid-u1");
  open();
  assert.equal(await one.status, 401);
  assert.equal(stream.perKey.get("u1"), undefined);
  tokens.signIn("u1");
});
