// src/dashboard/routes/snapshots.ts — 백업 탭의 스냅샷 목록 · 복원 걸기 · 거두기

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const snapshots = await import("../../src/store/snapshots.ts");
const { RECENT_LOGIN_MS } = await import("../../src/dashboard/middleware/recent-login.ts");
const { snapshotsRouter } = await import("../../src/dashboard/routes/snapshots.ts");

const store = openTempStore("snapshots-route-");
let loginAt = Date.now();
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt });
  next();
});
app.use("/api/admin/snapshots", snapshotsRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/snapshots`;
after(() => {
  server.close();
  snapshots.unstage();
  store.close();
});

type View = { rows: { name: string; kind: string }[]; staged: string | null; code?: string };
const call = async (method: string, route: string, body?: unknown) => {
  const res = await fetch(base + route, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as View };
};

test("목록 · 복원 걸기 · 거두기", async () => {
  const name = await snapshots.take("daily", new Date(2026, 9, 10));
  const listed = await call("GET", "/");
  assert.deepEqual([listed.status, listed.json.rows.map((one) => one.name), listed.json.staged], [200, [name], null]);

  const staged = await call("POST", "/restore", { name });
  assert.deepEqual([staged.status, staged.json.staged], [200, name]);
  const removed = await call("DELETE", "/restore");
  assert.deepEqual([removed.status, removed.json.staged], [200, null]);
});

test("없는 스냅샷은 404, 이름이 없으면 400", async () => {
  const missing = await call("POST", "/restore", { name: "settings-daily-1999-01-01.db" });
  assert.deepEqual([missing.status, missing.json.code], [404, "snapshot-not-found"]);
  assert.equal((await call("POST", "/restore", {})).status, 400);
});

test("복원을 거는 것은 최근 로그인만", async () => {
  const name = await snapshots.take("daily", new Date(2026, 9, 9));
  loginAt = Date.now() - RECENT_LOGIN_MS - 1;
  try {
    const res = await call("POST", "/restore", { name });
    assert.deepEqual([res.status, res.json.code], [403, "reauth-required"]);
    assert.equal(snapshots.staged(), null);
  } finally {
    loginAt = Date.now();
  }
});
