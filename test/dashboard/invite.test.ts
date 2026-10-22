// src/dashboard/routes/invite.ts · invite.ts — 봇 초대 화면(/api/invite).
// 디스코드를 부르는 HTTP 클라이언트는 가짜를 넘긴다. 토큰은 진짜 세션 저장소(임시 DB)의 세션 행에 둔다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { SessionData } from "express-session";
import { fake, fakeBot } from "../helpers/fake.ts";
import { requestJson, type ProblemReply } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import { createInviteRouter } from "../../src/dashboard/routes/invite.ts";
import { _setAppInfo, canInvite, loadAppInfo, managedGuilds, KEEP_MS, FRESH_GAP_MS } from "../../src/dashboard/invite.ts";
import type { DiscordHttp } from "../../src/dashboard/discord-api.ts";
import type { Client } from "discord.js";
import type { InviteList } from "../../src/dashboard/contract/invite.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-invite-"));
secrets._useKey(newSecretsKey());
const store = new SqliteSessionStore({ dbPath: path.join(tmpDir, "sessions.db") });

// 권한 비트: 서버 관리(0x20) · 관리자(0x8)
const ROWS = [
  { id: "10", name: "내 서버", icon: "abc", owner: true, permissions: "0" },
  { id: "11", name: "관리하는 서버", icon: null, owner: false, permissions: String(0x20) },
  { id: "12", name: "관리자인 서버", icon: null, owner: false, permissions: String(0x8) },
  { id: "13", name: "멤버만인 서버", icon: null, owner: false, permissions: String(0x400) },
  { id: "14", name: "봇이 있는 서버", icon: null, owner: true, permissions: "0" },
];

let reply: () => Promise<{ data: unknown }> = async () => ({ data: ROWS });
const asked: string[] = [];
const http = fake<DiscordHttp>({
  get: async (url: string, init: { headers: { Authorization: string } }) => {
    asked.push(`${url} ${init.headers.Authorization}`);
    return reply();
  },
});

let sid = "sid-1";
const app = express();
app.use((req: Request, _res: Response, next: NextFunction) => {
  Object.assign(req, { session: fake<Request["session"]>({ user: { id: "u1", username: "u1" }, loginAt: Date.now() }), sessionID: sid, sessionStore: store });
  next();
});
app.locals.bot = fakeBot({ client: { isReady: () => true, guilds: { cache: new Map([["14", {}]]) } } });
app.use("/api/invite", createInviteRouter({ http }));
const server = await listenForFetch(app);
const base = baseUrl(server);

after(() => {
  server.close();
  store.close();
  _setAppInfo(null);
  secrets._useKey();
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
});

const signIn = (id: string, token: string | null) => {
  store.set(id, fake<SessionData>({ cookie: { expires: new Date(Date.now() + 60_000).toISOString() } }));
  if (token) store.saveDiscordToken(id, token);
};

beforeEach(() => {
  _setAppInfo({ botPublic: true, requireCodeGrant: false, ownerIds: [] });
  reply = async () => ({ data: ROWS });
  asked.length = 0;
  sid = `sid-${Math.random()}`;
});

test("서버 관리 권한(소유자 · 관리자 포함)이 있고 봇이 없는 서버를, 그 서버를 미리 고른 초대 링크와 함께 준다", async () => {
  signIn(sid, "tok");
  const out = await requestJson<InviteList>(base, "GET", "/api/invite");
  assert.equal(out.status, 200);
  assert.equal(out.json.state, "ready");
  const guilds = out.json.state === "ready" ? out.json.guilds : [];
  assert.deepEqual(
    guilds.map((g) => g.id),
    ["10", "11", "12"],
  );
  assert.equal(guilds[0].icon, "https://cdn.discordapp.com/icons/10/abc.webp?size=64", "그림 주소는 서버가 만든다");
  assert.match(guilds[0].inviteUrl, /^https:\/\/discord\.com\/oauth2\/authorize\?client_id=[^&]*&permissions=\d+&scope=bot%20applications\.commands&guild_id=10&disable_guild_select=true$/);
  assert.deepEqual(asked, ["https://discord.com/api/v10/users/@me/guilds Bearer tok"], "세션 행의 토큰으로 묻는다");
});

test("잠깐 둔 목록: 다시 열면 디스코드에 묻지 않는다", async () => {
  signIn(sid, "tok");
  await requestJson(base, "GET", "/api/invite");
  await requestJson(base, "GET", "/api/invite");
  await requestJson(base, "GET", "/api/invite?fresh=1");
  assert.equal(asked.length, 1, "갱신 버튼도 잠깐 사이에는 다시 묻지 않는다");
});

test("둔 목록의 기한: 30초가 지나면 다시 묻고, 갱신 버튼은 10초가 지나면 다시 묻는다", async () => {
  let calls = 0;
  const counted = fake<DiscordHttp>({
    get: async () => {
      calls++;
      return { data: ROWS };
    },
  });
  const t0 = 1_000_000_000;
  await managedGuilds("k", "tok", { http: counted, now: t0 });
  await managedGuilds("k", "tok", { http: counted, now: t0 + FRESH_GAP_MS - 1, fresh: true });
  assert.equal(calls, 1);
  await managedGuilds("k", "tok", { http: counted, now: t0 + FRESH_GAP_MS, fresh: true });
  assert.equal(calls, 2);
  await managedGuilds("k", "tok", { http: counted, now: t0 + FRESH_GAP_MS + KEEP_MS - 1 });
  assert.equal(calls, 2);
  await managedGuilds("k", "tok", { http: counted, now: t0 + FRESH_GAP_MS + KEEP_MS });
  assert.equal(calls, 3);
});

test("토큰이 없거나 디스코드가 토큰을 거절하면(401) 다시 로그인 안내", async () => {
  signIn(sid, null);
  assert.deepEqual((await requestJson<InviteList>(base, "GET", "/api/invite")).json, { state: "relogin" });
  assert.equal(asked.length, 0);

  sid = `sid-${Math.random()}`;
  signIn(sid, "expired");
  reply = () => Promise.reject(Object.assign(new Error("HTTP 401"), { response: { status: 401 } }));
  assert.deepEqual((await requestJson<InviteList>(base, "GET", "/api/invite")).json, { state: "relogin" });
});

test("디스코드가 요청을 막으면(429) rate-limited, 초대할 수 없는 사람은 invite-unavailable", async () => {
  signIn(sid, "tok");
  reply = () => Promise.reject(Object.assign(new Error("HTTP 429"), { response: { status: 429 } }));
  const limited = await requestJson<ProblemReply>(base, "GET", "/api/invite");
  assert.deepEqual([limited.status, limited.json.code], [503, "rate-limited"]);

  _setAppInfo({ botPublic: false, requireCodeGrant: false, ownerIds: ["someone-else"] });
  const refused = await requestJson<ProblemReply>(base, "GET", "/api/invite");
  assert.deepEqual([refused.status, refused.json.code], [403, "invite-unavailable"]);
});

test("앱 정보: 봇이 준비되기 전에 물어도 막히지 않고, 준비된 뒤 받는다. 팀이면 팀원", async () => {
  _setAppInfo(null);
  const client = { application: null as unknown };
  await loadAppInfo(fake<Client>(client));
  assert.equal(canInvite(fake<Client>(client), "u1"), false, "준비 전");

  client.application = {
    fetch: async () => ({
      botPublic: false,
      botRequireCodeGrant: false,
      owner: {
        members: new Map([
          ["t1", {}],
          ["t2", {}],
        ]),
      },
    }),
  };
  await loadAppInfo(fake<Client>(client));
  assert.deepEqual([canInvite(fake<Client>(client), "t2"), canInvite(fake<Client>(client), "u1")], [true, false]);
});

test("응답 어디에도 디스코드 토큰이 없다(목록 · 다시 로그인 · 실패)", async () => {
  const raw = async () => (await fetch(`${base}/api/invite`)).text();
  signIn(sid, "tok-should-not-leak");
  const bodies = [await raw()];
  reply = () => Promise.reject(Object.assign(new Error("HTTP 401 tok-should-not-leak"), { response: { status: 401 } }));
  sid = `sid-${Math.random()}`;
  signIn(sid, "tok-should-not-leak");
  bodies.push(await raw());
  reply = () => Promise.reject(Object.assign(new Error("HTTP 500 tok-should-not-leak"), { response: { status: 500 } }));
  sid = `sid-${Math.random()}`;
  signIn(sid, "tok-should-not-leak");
  bodies.push(await raw());
  for (const body of bodies) assert.equal(body.includes("tok-should-not-leak"), false, body.slice(0, 80));
});
