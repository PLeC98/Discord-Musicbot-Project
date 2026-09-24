// dashboard/server/routes/auth.js — 디스코드 OAuth 로그인 · 콜백 · 로그아웃.
// 디스코드를 부르는 HTTP 클라이언트는 가짜를 넘긴다. 세션은 express-session 의 메모리 저장소.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import authModule from "../../dashboard/server/routes/auth.js";
const { createAuthRouter } = authModule;
import listen from "../helpers/listen.js";
const { listenForFetch } = listen;

const servers = [];
after(() => servers.forEach((s) => s.close()));

// 가짜 디스코드. 부른 것을 적고, 정한 답을 준다
function fakeDiscord({ fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async post(url, body) {
      calls.push({ method: "post", url, body: Object.fromEntries(body) });
      if (fail) throw fail;
      return { data: { access_token: "tok", token_type: "Bearer" } };
    },
    async get(url, opts) {
      calls.push({ method: "get", url, auth: opts.headers.Authorization });
      if (url.endsWith("/users/@me")) return { data: { id: "u1", username: "user", global_name: null, avatar: "av" } };
      return { data: [{ id: "g1" }] };
    },
  };
}

async function start(http) {
  const app = express();
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
  app.use("/auth", createAuthRouter({ http }));
  app.get("/me", (req, res) => res.json(req.session.user ?? null));
  const server = await listenForFetch(app);
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  const go = async (path, init = {}) => {
    const res = await fetch(base + path, { redirect: "manual", ...init, headers: { cookie, ...init.headers } });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  };
  return { go };
}

test("로그인: state 를 세션에 두고 디스코드 인가 화면으로 보낸다", async () => {
  const { go } = await start(fakeDiscord());
  const res = await go("/auth/login");
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location"));
  assert.equal(to.origin + to.pathname, "https://discord.com/api/v10/oauth2/authorize");
  assert.equal(to.searchParams.get("scope"), "identify guilds");
  assert.match(to.searchParams.get("redirect_uri"), /\/auth\/callback$/);
  assert.match(to.searchParams.get("state"), /^[0-9a-f]{32}$/);
});

test("콜백: 코드가 없거나 state 가 안 맞으면 디스코드를 부르지 않고 실패로 돌려보낸다", async () => {
  const discord = fakeDiscord();
  const { go } = await start(discord);
  assert.equal((await go("/auth/callback")).headers.get("location"), "/?error=no_code");
  assert.equal((await go("/auth/callback?code=c&state=x")).headers.get("location"), "/?error=auth_failed", "로그인 전");

  const state = new URL((await go("/auth/login")).headers.get("location")).searchParams.get("state");
  assert.equal((await go("/auth/callback?code=c&state=wrong")).headers.get("location"), "/?error=auth_failed");
  assert.equal((await go(`/auth/callback?code=c&state=${state}`)).headers.get("location"), "/?error=auth_failed", "한 번 맞춰 본 state 는 버린다");
  assert.equal(discord.calls.length, 0);
});

test("콜백: 코드를 토큰으로 바꾸고 사용자 · 서버 목록을 세션에 담아 대시보드로 보낸다. 세션 id 는 새로 받는다", async () => {
  const discord = fakeDiscord();
  const { go } = await start(discord);
  const login = await go("/auth/login");
  const before = login.headers.get("set-cookie").split(";")[0];
  const state = new URL(login.headers.get("location")).searchParams.get("state");

  const res = await go(`/auth/callback?code=abc&state=${state}`);
  assert.equal(res.headers.get("location"), "/dashboard");
  assert.notEqual(res.headers.get("set-cookie").split(";")[0], before, "세션 고정 공격을 막으려고 새 id");

  const [token, me, guilds] = discord.calls;
  assert.equal(token.url, "https://discord.com/api/v10/oauth2/token");
  assert.equal(token.body.code, "abc");
  assert.equal(token.body.grant_type, "authorization_code");
  assert.equal(me.auth, "Bearer tok");
  assert.equal(guilds.url, "https://discord.com/api/v10/users/@me/guilds");

  const user = await (await go("/me")).json();
  assert.deepEqual(user, { id: "u1", username: "user", globalName: "user", avatar: "av", guilds: [{ id: "g1" }] });
});

test("콜백: 디스코드가 실패하면 실패로 돌려보낸다", async () => {
  const fail = Object.assign(new Error("bad"), { response: { status: 400, data: { error: "invalid_grant" } } });
  const { go } = await start(fakeDiscord({ fail }));
  const state = new URL((await go("/auth/login")).headers.get("location")).searchParams.get("state");
  assert.equal((await go(`/auth/callback?code=abc&state=${state}`)).headers.get("location"), "/?error=auth_failed");
  assert.equal(await (await go("/me")).json(), null);
});

test("로그아웃: 세션을 지우고 204", async () => {
  const { go } = await start(fakeDiscord());
  const state = new URL((await go("/auth/login")).headers.get("location")).searchParams.get("state");
  await go(`/auth/callback?code=abc&state=${state}`);
  assert.equal((await go("/auth/logout", { method: "POST" })).status, 204);
  assert.equal(await (await go("/me")).json(), null);
});
