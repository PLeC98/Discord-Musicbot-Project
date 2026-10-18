// src/dashboard/routes/reset.ts — 초기화 경로. 모두 최근 로그인, 봇 전체 초기화는 봇 이름을 그대로 입력해야 하고 예약한 복원을 취소한다.
// 실행기로 켰으면 답을 보낸 뒤 다시 시작하고, 아니면 예약만 남는다(배너 · 예약 취소).

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake, fakeBot } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const { resetRouter } = await import("../../src/dashboard/routes/reset.ts");
const { RECENT_LOGIN_MS } = await import("../../src/dashboard/middleware/recent-login.ts");
const snapshots = await import("../../src/store/snapshots.ts");
const fullReset = await import("../../src/store/full-reset.ts");
const pinnedSources = await import("../../src/store/pinned-sources.ts");

const store = openTempStore("reset-route-");
let loginAt = Date.now();
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt });
  next();
});
app.use("/api/admin/reset", resetRouter);
app.locals.bot = fakeBot({ client: { user: { username: "테스트 봇" } } });
app.locals.restart = null; // 실행기 없이 켰다(다시 시작 테스트가 바꾼다)
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/reset`;
after(() => {
  server.close();
  fullReset.cancel();
  snapshots.unstage();
  store.close();
});

type Json = Record<string, unknown> & { code?: string; errors?: Array<{ pointer: string; code: string }> };
const call = async (method: string, body?: unknown) => {
  const res = await fetch(base + (method === "DELETE" ? "/staged" : ""), { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Json };
};

test("모두 최근 로그인을 본다", async () => {
  loginAt = Date.now() - RECENT_LOGIN_MS - 1;
  try {
    for (const [method, body] of [["GET"], ["POST", { kind: "display" }], ["DELETE"]] as const) assert.equal((await call(method, body)).json.code, "reauth-required", method);
  } finally {
    loginAt = Date.now();
  }
});

test("초기화 정보: 줄마다의 양 · 봇 이름 · 실행기 여부 · 예약", async () => {
  pinnedSources.setPin("https://y/a", "https://soundcloud.com/a/b");
  const { status, json } = await call("GET");
  assert.equal(status, 200);
  assert.deepEqual([(json.audioCache as { pins: number }).pins, json.botName, json.launcher, json.staged, json.restore], [1, "테스트 봇", false, false, { snapshot: null, audioCache: false }]);
});

test("오디오 캐시: 선택이 비면 400, 선택한 것만 지운다", async () => {
  const empty = await call("POST", { kind: "audio-cache", parts: [] });
  assert.deepEqual([empty.status, empty.json.code, empty.json.errors?.[0]?.pointer], [400, "nothing-to-save", "/parts"]);
  assert.equal((await call("POST", { kind: "audio-cache", parts: ["everything"] })).status, 400);

  const done = await call("POST", { kind: "audio-cache", parts: ["pins", "pins"] });
  assert.deepEqual([done.status, done.json.kind, done.json.cleared], [200, "audio-cache", { pins: 1 }]);
  assert.equal(pinnedSources.getPin("https://y/a"), null);
});

test("봇 전체: 이름이 다르면 거절, 맞으면 예약한 복원을 취소하고 스냅샷을 남겨 예약한다(실행기 없이 켰으면 다시 시작하지 않는다)", async () => {
  const staged = await snapshots.take("daily", new Date(2026, 9, 1));
  snapshots.stage(staged);
  assert.equal((await call("POST", { kind: "all", confirmName: "다른 봇" })).json.code, "reset-name-mismatch");
  assert.equal(fullReset.requested(), false);

  const done = await call("POST", { kind: "all", confirmName: "테스트 봇" });
  assert.equal(done.status, 200);
  assert.deepEqual([done.json.restarting, done.json.unstaged], [false, { snapshot: staged, audioCache: false }]);
  assert.match(String(done.json.snapshot), /^settings-before-reset-/);
  assert.deepEqual([fullReset.requested(), snapshots.staged()], [true, null]);
  assert.equal((await call("GET")).json.staged, true);
  assert.equal((await call("POST", { kind: "all", confirmName: "테스트 봇" })).json.code, "reset-already-staged");

  const cancelled = await call("DELETE");
  assert.deepEqual([cancelled.status, cancelled.json.staged, fullReset.requested()], [200, false, false]);
  assert.equal((await call("DELETE")).json.code, "reset-not-staged");
});

test("봇 전체: 실행기로 켰으면 답을 보낸 뒤 다시 시작한다", async () => {
  const restarted: string[] = [];
  app.locals.restart = (by) => void restarted.push(by);
  try {
    assert.equal((await call("GET")).json.launcher, true);
    const done = await call("POST", { kind: "all", confirmName: "테스트 봇" });
    assert.equal(done.json.restarting, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(restarted, ["owner"]);
  } finally {
    app.locals.restart = null;
    fullReset.cancel();
  }
});
