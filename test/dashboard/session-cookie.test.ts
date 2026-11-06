// src/dashboard/index.ts 의 createSessionMiddleware, cookies.ts: 세션 쿠키 이름은 요청마다. HTTPS(믿는 프록시가 알림)면 __Host- 이름에 Secure,
// 평문이면 일반 이름(지금 되는 배치를 로그인 불가로 바꾸지 않는다). 두 이름이 같은 저장소의 세션을 쓴다. 임시 DB

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createSessionMiddleware } from "../../src/dashboard/index.ts";
import { sessionCookieName } from "../../src/dashboard/cookies.ts";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";

secrets._useKey(newSecretsKey());
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-session-cookie-"));
const store = new SqliteSessionStore({ dbPath: path.join(dir, "sessions.db") });
const app = express();
app.set("trust proxy", "loopback");
app.use(createSessionMiddleware({ store, secret: "test-secret-0123456789-0123456789" }));
app.post("/login", (req, res) => {
  req.session.user = { id: "u1", username: "u1", globalName: "u1", avatar: null };
  req.session.loginAt = Date.now();
  req.session.save(() => res.status(204).end());
});
app.get("/me", (req, res) => res.json(req.session.user?.id ?? null));
const server = await listenForFetch(app);
const base = baseUrl(server);
after(() => {
  server.close();
  store.close();
  secrets._useKey();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const HTTPS = { "x-forwarded-proto": "https" };

test("HTTPS 요청이면 __Host- 이름에 Secure, Path=/, Domain 없음", async () => {
  const [cookie] = (await fetch(`${base}/login`, { method: "POST", headers: HTTPS })).headers.getSetCookie();
  assert.ok(cookie.startsWith(`${sessionCookieName(true)}=`), cookie);
  assert.match(sessionCookieName(true), /^__Host-/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test("평문 요청이면 일반 이름, Secure 없음(로그인이 그대로 된다). 두 이름 모두 같은 저장소의 세션을 읽는다", async () => {
  const [plain] = (await fetch(`${base}/login`, { method: "POST" })).headers.getSetCookie();
  assert.ok(plain.startsWith(`${sessionCookieName(false)}=`), plain);
  assert.doesNotMatch(plain, /Secure/);
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: plain.split(";")[0] } })).json(), "u1");

  const [secure] = (await fetch(`${base}/login`, { method: "POST", headers: HTTPS })).headers.getSetCookie();
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: secure.split(";")[0], ...HTTPS } })).json(), "u1");
  assert.equal(store.db.prepare("SELECT COUNT(*) FROM sessions").pluck().get(), 3, "세 로그인 모두 한 저장소에");
});

test("HTTPS 쿠키는 평문 요청에 쓰이지 않는다(이름이 다르다)", async () => {
  const [secure] = (await fetch(`${base}/login`, { method: "POST", headers: HTTPS })).headers.getSetCookie();
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: secure.split(";")[0] } })).json(), null);
});
