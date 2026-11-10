// src/dashboard/index.ts의 createSessionMiddleware, cookies.ts: 세션 쿠키 이름은 요청마다 정한다. HTTPS(신뢰하는 프록시가 알림)면 __Host- 이름에 Secure를 붙이고,
// 평문이면 일반 이름을 쓴다(기존 배포 환경을 로그인 불가로 바꾸지 않는다). 두 이름이 같은 저장소의 세션을 쓴다. 임시 DB를 쓴다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express, { type Request } from "express";
import { fake } from "../helpers/fake.ts";
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
// 대시보드의 로그인(routes/auth의 signIn)처럼 세션을 새로 만든 뒤 사용자를 담는다
app.post("/relogin", (req, res) => {
  req.session.regenerate(() => {
    req.session.user = { id: "u2", username: "u2", globalName: "u2", avatar: null };
    req.session.loginAt = Date.now();
    req.session.save(() => res.status(204).end());
  });
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

test("HTTPS 요청이면 __Host- 이름에 Secure, Path=/가 붙고 Domain은 없다", async () => {
  const [cookie] = (await fetch(`${base}/login`, { method: "POST", headers: HTTPS })).headers.getSetCookie();
  assert.ok(cookie.startsWith(`${sessionCookieName(true)}=`), cookie);
  assert.match(sessionCookieName(true), /^__Host-/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test("평문 요청이면 일반 이름에 Secure가 없다(로그인이 그대로 된다). 두 이름 모두 같은 저장소의 세션을 읽는다", async () => {
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

/** 쿠키 한 줄의 값(서명한 세션 id). 이름과 상관없이 같은 값이다 */
const valueOf = (cookie: string) => cookie.split(";")[0].split("=").slice(1).join("=");
/** 쿠키 값의 세션 id(s:<id>.<서명>) */
const sidOf = (cookie: string) => decodeURIComponent(valueOf(cookie)).slice(2).split(".")[0];
const hasSession = (sid: string) => store.db.prepare("SELECT 1 FROM sessions WHERE sid = ?").get(sid) !== undefined;

test("평문에서 만든 세션 id를 __Host- 이름으로 HTTPS 요청에 보내면 받지 않고 그 세션을 삭제한다", async () => {
  const [plain] = (await fetch(`${base}/login`, { method: "POST" })).headers.getSetCookie();
  assert.ok(hasSession(sidOf(plain)));
  const upgraded = await fetch(`${base}/me`, { headers: { cookie: `${sessionCookieName(true)}=${valueOf(plain)}`, ...HTTPS } });
  assert.equal(await upgraded.json(), null);
  assert.equal(hasSession(sidOf(plain)), false, "가로챈 id의 세션은 삭제한다");
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: plain.split(";")[0] } })).json(), null, "원래 평문 쿠키의 로그인도 끝난다");
});

test("HTTPS에서 만든 세션 id를 평문 이름으로 보내도 받지 않는다", async () => {
  const [secure] = (await fetch(`${base}/login`, { method: "POST", headers: HTTPS })).headers.getSetCookie();
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: `${sessionCookieName(false)}=${valueOf(secure)}` } })).json(), null);
});

test("createdOverHttps가 없는 세션(이 값을 적기 전에 만든 세션)은 평문으로 만든 것으로 본다", async () => {
  const [plain] = (await fetch(`${base}/login`, { method: "POST" })).headers.getSetCookie();
  const sid = sidOf(plain);
  const row = store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(sid) as string;
  const data = JSON.parse(row) as Record<string, unknown>;
  delete data.createdOverHttps;
  store.db.prepare("UPDATE sessions SET data = ? WHERE sid = ?").run(JSON.stringify(data), sid);
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: plain.split(";")[0] } })).json(), "u1", "평문 요청에는 그대로");
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: `${sessionCookieName(true)}=${valueOf(plain)}`, ...HTTPS } })).json(), null, "HTTPS 요청에는 받지 않는다");
});

test("다시 로그인(regenerate)으로 만든 세션에도 createdOverHttps를 적는다", async () => {
  const [secure] = (await fetch(`${base}/relogin`, { method: "POST", headers: HTTPS })).headers.getSetCookie();
  assert.ok(secure.startsWith(`${sessionCookieName(true)}=`), secure);
  assert.equal(await (await fetch(`${base}/me`, { headers: { cookie: secure.split(";")[0], ...HTTPS } })).json(), "u2");
});

test("세션 쿠키의 Secure는 이름과 같은 판정(req.secure)을 따른다: 소켓이 TLS여도 신뢰하는 프록시가 http라고 알리면 Secure를 빼고 평문 세션으로 만든다", () => {
  const req = fake<Request>({ secure: false, connection: { encrypted: true }, socket: { encrypted: true }, headers: {} });
  store.generate(req);
  assert.equal(req.session.cookie.secure, false);
  assert.equal(req.session.createdOverHttps, false);
  const https = fake<Request>({ secure: true, connection: {}, socket: {}, headers: {} });
  store.generate(https);
  assert.equal(https.session.cookie.secure, true);
  assert.equal(https.session.createdOverHttps, true);
});
