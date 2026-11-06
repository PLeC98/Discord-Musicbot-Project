// src/dashboard/middleware/same-account.ts: 탭이 생각하는 사용자와 세션의 사용자가 다르면 409 account-changed. CSRF 검사보다 앞

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requireSameAccount } from "../../src/dashboard/middleware/same-account.ts";
import { requireCsrfToken } from "../../src/dashboard/middleware/csrf.ts";
import { fake } from "../helpers/fake.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";

const app = express();
// 지금 쿠키의 세션은 B 다(다른 탭에서 B 로 로그인했다)
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "B", username: "B" }, csrfToken: "token-b" });
  next();
});
app.use(requireSameAccount);
app.use(requireCsrfToken);
app.all("/{*path}", (_req, res) => res.json({ ok: true }));
const server = await listenForFetch(app);
const base = baseUrl(server);
after(() => server.close());

const code = async (res: Response) => (res.status === 200 ? "ok" : ((await res.json()) as { code: string }).code);

test("옛 계정(A)의 탭이 보낸 요청은 409. 상태를 바꾸는 요청도 CSRF 검사보다 먼저(새 계정의 토큰으로 다시 보내지 못하게)", async () => {
  assert.equal(await code(await fetch(`${base}/api/guilds`, { headers: { "x-dashboard-user": "A" } })), "account-changed");
  assert.equal((await fetch(`${base}/api/guilds`, { headers: { "x-dashboard-user": "A" } })).status, 409);
  assert.equal(await code(await fetch(`${base}/api/admin/broadcast`, { method: "POST", headers: { "x-dashboard-user": "A" } })), "account-changed");
  assert.equal(await code(await fetch(`${base}/api/admin/broadcast`, { method: "POST", headers: { "x-dashboard-user": "A", "x-csrf-token": "token-b" } })), "account-changed");
});

test("같은 계정이거나 싣지 않았으면 지나간다. 계정을 알아보는 /api/me, 로그아웃은 보지 않는다", async () => {
  assert.equal(await code(await fetch(`${base}/api/guilds`, { headers: { "x-dashboard-user": "B" } })), "ok");
  assert.equal(await code(await fetch(`${base}/api/guilds`)), "ok");
  assert.equal(await code(await fetch(`${base}/api/me`, { headers: { "x-dashboard-user": "A" } })), "ok");
  assert.equal(await code(await fetch(`${base}/auth/logout`, { method: "POST", headers: { "x-dashboard-user": "A", "x-csrf-token": "token-b" } })), "ok");
});

test("머리를 못 싣는 스트림은 uid 쿼리로. 스트림 경로에서만 본다", async () => {
  for (const stream of ["/api/guilds/events", "/api/admin/logs/stream", "/api/admin/ai/logs/stream"]) {
    assert.equal(await code(await fetch(`${base}${stream}?uid=A`)), "account-changed", stream);
    assert.equal(await code(await fetch(`${base}${stream}?uid=B`)), "ok", stream);
  }
  assert.equal(await code(await fetch(`${base}/api/guilds?uid=A`)), "ok", "다른 경로의 uid 는 보지 않는다");
});
