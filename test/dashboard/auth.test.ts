// src/dashboard/routes/auth.ts: 디스코드 OAuth 로그인, 콜백, 로그아웃.
// 디스코드를 부르는 HTTP 클라이언트는 가짜를 넘긴다. 세션은 express-session 의 메모리 저장소(진짜 저장소가 필요한 것은 임시 SQLite).
// 로그인 요청(state, 팝업 여부)은 세션이 아니라 잠근 쿠키 하나에 든다. 비밀 키는 시험 키

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash } from "node:crypto";
import session from "express-session";
import type { Server } from "node:http";
import { createAuthRouter } from "../../src/dashboard/routes/auth.ts";
import type { DiscordHttp } from "../../src/dashboard/discord-api.ts";
import { requireRecentLogin, RECENT_LOGIN_MS } from "../../src/dashboard/middleware/recent-login.ts";
import { fake } from "../helpers/fake.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";
import * as listen from "../helpers/listen.ts";
import { cookieJar } from "../helpers/cookie-jar.ts";
import { sessionCookieName } from "../../src/dashboard/cookies.ts";
import * as sessionRequests from "../../src/dashboard/session-requests.ts";
const { listenForFetch } = listen;

const servers: Server[] = [];
// 대시보드의 평문 세션 쿠키 이름(로그아웃이 같은 이름을 지운다)
const SESSION = sessionCookieName(false);
before(() => secrets._useKey(newSecretsKey()));
after(() => {
  servers.forEach((s) => s.close());
  secrets._useKey();
});

// 가짜 디스코드. 부른 것을 적고, 정한 답을 준다
type Call = { method: string; url: string; body?: Record<string, string>; auth?: string };

// hold: 토큰 교환을 풀어 줄 때까지 멈춘다(디스코드를 기다리는 사이)
function fakeDiscord({ fail = null as Error | null, hold = null as Promise<void> | null } = {}) {
  const calls: Call[] = [];
  return {
    calls,
    async post(url: string, body: URLSearchParams) {
      calls.push({ method: "post", url, body: Object.fromEntries(body) });
      if (hold && url.endsWith("/oauth2/token")) await hold;
      if (fail) throw fail;
      return { data: { access_token: "tok", token_type: "Bearer" } };
    },
    async get(url: string, opts: { headers: { Authorization: string } }) {
      calls.push({ method: "get", url, auth: opts.headers.Authorization });
      if (url.endsWith("/users/@me")) return { data: { id: "u1", username: "user", global_name: null, avatar: "av" } };
      return { data: [{ id: "g1" }] };
    },
  };
}

// maxAge: 쿠키 수명(대시보드는 7일)
async function start(http: ReturnType<typeof fakeDiscord>, { store, maxAge }: { store?: SqliteSessionStore; maxAge?: number } = {}) {
  const app = express();
  // 믿는 프록시(시험은 같은 기기)가 HTTPS 라고 알리면 req.secure
  app.set("trust proxy", "loopback");
  app.use(session({ name: SESSION, secret: "test-secret", resave: false, saveUninitialized: false, store, cookie: maxAge ? { maxAge } : {} }));
  app.use(sessionRequests.bind);
  app.use("/auth", createAuthRouter({ http: fake<DiscordHttp>(http) }));
  app.get("/me", (req, res) => res.json(req.session.user ?? null));
  // 위험한 조작 경로, 로그인한 지 오래된 것처럼 만들기(테스트만)
  app.post("/risky", requireRecentLogin, (_req, res) => res.json({ ok: true }));
  app.post("/age-login", (req, res) => {
    req.session.loginAt = Date.now() - RECENT_LOGIN_MS - 1;
    res.status(204).end();
  });
  // 세션을 읽은 뒤 풀어 줄 때까지 걸려 있다가 세션을 바꿔 저장하는 요청(같은 때의 다른 창)
  let release: () => void = () => {};
  let entered: () => void = () => {};
  app.post("/hold", async (req, res) => {
    entered();
    await new Promise<void>((done) => (release = done));
    req.session.csrfToken = "다른 창이 저장";
    res.status(204).end();
  });
  const server = await listenForFetch(app);
  servers.push(server);
  const base = listen.baseUrl(server);
  const jar = cookieJar();
  const go = async (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, { redirect: "manual", ...init, headers: { cookie: jar.header(), ...init.headers } });
    jar.take(res);
    return res;
  };
  // 걸어 둔다. 핸들러에 들어갈 때까지 기다리고, 풀 함수와 응답을 돌려준다
  const hold = async () => {
    const inside = new Promise<void>((done) => (entered = done));
    const answer = go("/hold", { method: "POST" });
    await inside;
    return { release: () => release(), answer };
  };
  return { go, jar, hold };
}

const location = (res: globalThis.Response) => res.headers.get("location") ?? "";
const stateOf = (res: globalThis.Response) => new URL(location(res)).searchParams.get("state");
const loginCookieOf = (res: globalThis.Response) => res.headers.getSetCookie().find((line) => /^(__Host-)?musicbot-login-/.test(line)) ?? "";

test("로그인: 세션을 만들지 않고 state 를 잠근 쿠키에 둔 뒤 디스코드 인가 화면으로 보낸다", async () => {
  const { go, jar } = await start(fakeDiscord());
  const res = await go("/auth/login");
  assert.equal(res.status, 302);
  const to = new URL(location(res));
  assert.equal(to.origin + to.pathname, "https://discord.com/api/v10/oauth2/authorize");
  assert.equal(to.searchParams.get("scope"), "identify guilds");
  assert.match(to.searchParams.get("redirect_uri") ?? "", /\/auth\/callback$/);
  const state = to.searchParams.get("state") ?? "";
  assert.match(state, /^[A-Za-z0-9_-]{43}$/, "32바이트");
  assert.match(to.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/, "PKCE");
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(
    jar.names().filter((name) => !name.startsWith("musicbot-login-")),
    [],
    "로그인 전 세션 쿠키가 없다",
  );
  const cookie = loginCookieOf(res);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=600/);
  assert.doesNotMatch(cookie, /Secure/, "평문");
  assert.ok(!cookie.includes(state), "state 가 평문으로 실리지 않는다");
});

test("로그인: HTTPS 로 들어오면(믿는 프록시가 알림) __Host- 이름에 Secure", async () => {
  const { go } = await start(fakeDiscord());
  const cookie = loginCookieOf(await go("/auth/login", { headers: { "x-forwarded-proto": "https" } }));
  assert.match(cookie, /^__Host-musicbot-login-/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test("콜백: 코드가 없거나, 쿠키가 없거나, state 가 안 맞거나, 위조한 쿠키면 디스코드를 부르지 않고 실패로 돌려보낸다. 쿠키는 모든 길에서 지운다", async () => {
  const discord = fakeDiscord();
  const { go, jar } = await start(discord);
  assert.equal(location(await go("/auth/callback?code=c&state=x")), "/?error=auth_failed", "쿠키 없음");

  await go("/auth/login");
  const noCode = await go("/auth/callback");
  assert.equal(location(noCode), "/?error=no_code");
  assert.match(loginCookieOf(noCode), /Expires=Thu, 01 Jan 1970/, "지운다");

  await go("/auth/login");
  assert.equal(location(await go("/auth/callback?error=access_denied&state=x")), "/?error=denied", "승인 화면에서 취소");
  assert.deepEqual(jar.names(), [], "취소해도 지운다");

  await go("/auth/login");
  assert.equal(location(await go("/auth/callback?code=c&state=wrong")), "/?error=auth_failed");

  const forged = await start(discord);
  await forged.go("/auth/login");
  const name = forged.jar.names()[0];
  assert.equal(location(await forged.go("/auth/callback?code=c&state=x", { headers: { cookie: `${name}=${Buffer.from("가짜").toString("base64url")}` } })), "/?error=auth_failed", "위조");
  assert.equal(discord.calls.length, 0);
});

test("콜백: 쓴 state 는 다시 받지 않는다(지우기를 따르지 않는 클라이언트). 10분이 지난 쿠키도", async (t) => {
  const discord = fakeDiscord();
  const { go, jar } = await start(discord);
  const state = stateOf(await go("/auth/login"));
  const kept = jar.header();
  assert.equal(location(await go(`/auth/callback?code=abc&state=${state}`)), "/dashboard");
  assert.equal(location(await go(`/auth/callback?code=abc&state=${state}`, { headers: { cookie: kept } })), "/?error=auth_failed", "같은 쿠키, 같은 state 를 다시");

  const late = stateOf(await go("/auth/login"));
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10 * 60_000 + 1 });
  assert.equal(location(await go(`/auth/callback?code=abc&state=${late}`)), "/?error=auth_failed");
  assert.equal(discord.calls.length, 2, "처음 한 번의 토큰 교환과 사용자 조회만");
});

test("콜백: 코드를 토큰으로 바꾸고 사용자를 세션에 담아 대시보드로 보낸다(서버 목록은 받지 않는다). 로그인 쿠키는 지운다", async () => {
  const discord = fakeDiscord();
  const { go, jar } = await start(discord);
  const login = await go("/auth/login");
  const state = stateOf(login);
  const challenge = new URL(location(login)).searchParams.get("code_challenge");

  const res = await go(`/auth/callback?code=abc&state=${state}`);
  assert.equal(location(res), "/dashboard");
  assert.deepEqual(jar.names(), [SESSION], "세션 쿠키만 남는다");

  const [token, me, ...rest] = discord.calls;
  assert.equal(token.url, "https://discord.com/api/v10/oauth2/token");
  assert.equal(
    createHash("sha256")
      .update(token.body?.code_verifier ?? "")
      .digest("base64url"),
    challenge,
    "PKCE: 인가 때의 challenge 와 짝인 verifier",
  );
  assert.equal(token.body?.code, "abc");
  assert.equal(token.body?.grant_type, "authorization_code");
  assert.equal(me.auth, "Bearer tok");
  assert.deepEqual(rest, [], "서버 목록은 초대 화면이 열 때 받는다");

  const user = await (await go("/me")).json();
  assert.deepEqual(user, { id: "u1", username: "user", globalName: "user", avatar: "av" });
});

test("콜백: 다시 로그인하면 세션 id 를 새로 받는다(세션 고정을 막는다)", async () => {
  const { go, jar } = await start(fakeDiscord());
  await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`);
  const before = jar.get(SESSION);
  await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login?popup=1"))}`);
  assert.ok(before && jar.get(SESSION) && jar.get(SESSION) !== before);
});

// 화면이 연 로그인 창(다시 로그인)은 끝나면 창을 닫는 화면으로. 다음 로그인이 평소 로그인이면 대시보드로
test("콜백: 로그인 창(popup=1)으로 시작했으면 /login-done 으로 보낸다. 표시는 그 로그인 한 번만", async () => {
  const { go } = await start(fakeDiscord());
  assert.equal(location(await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login?popup=1"))}`)), "/login-done");
  assert.equal(location(await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`)), "/dashboard");
});

test("팝업 다시 로그인: 같은 때의 다른 창이 옛 세션을 저장해도 로그인이 깨지지 않는다", async () => {
  const { go, hold } = await start(fakeDiscord());
  await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`);
  // 다른 창의 요청이 세션을 읽은 뒤 로그인 창을 연다. 그 요청이 끝나며 자기가 읽은 세션을 저장한다
  const other = await hold();
  const state = stateOf(await go("/auth/login?popup=1"));
  other.release();
  assert.equal((await other.answer).status, 204);
  assert.equal(location(await go(`/auth/callback?code=abc&state=${state}`)), "/login-done");
});

test("위험한 조작: 로그인한 지 10분 안이면 받고, 지났으면 reauth-required(403). 로그인 전이면 login-required", async () => {
  const { go } = await start(fakeDiscord());
  assert.equal((await go("/risky", { method: "POST" })).status, 401);

  await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`);
  assert.equal((await go("/risky", { method: "POST" })).status, 200, "방금 로그인했다");

  await go("/age-login", { method: "POST" });
  const late = await go("/risky", { method: "POST" });
  assert.equal(late.status, 403);
  assert.equal(((await late.json()) as { code?: string }).code, "reauth-required");
  assert.equal((await go("/risky", { method: "POST" })).status, 403, "요청이 로그인 시각을 늘리지 않는다");
});

test("콜백: 디스코드가 실패하면 실패로 돌려보낸다", async () => {
  const fail = Object.assign(new Error("bad"), { response: { status: 400, data: { error: "invalid_grant" } } });
  const { go } = await start(fakeDiscord({ fail }));
  assert.equal(location(await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`)), "/?error=auth_failed");
  assert.equal(await (await go("/me")).json(), null);
});

test("콜백: 디스코드가 봇의 앱 자격(시크릿)을 거절하면 그 까닭으로 돌려보낸다", async () => {
  const fail = Object.assign(new Error("bad"), { response: { status: 401, data: { error: "invalid_client" } } });
  const { go } = await start(fakeDiscord({ fail }));
  assert.equal(location(await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`)), "/?error=bad_client");
  assert.equal(await (await go("/me")).json(), null);
});

test("로그아웃: 세션을 삭제하고 204", async () => {
  const { go } = await start(fakeDiscord());
  await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`);
  assert.equal((await go("/auth/logout", { method: "POST" })).status, 204);
  assert.equal(await (await go("/me")).json(), null);
});

// 진짜 저장소를 쓰는 시험. 임시 DB
async function withStore(run: (store: SqliteSessionStore) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-auth-"));
  const store = new SqliteSessionStore({ dbPath: path.join(dir, "sessions.db") });
  try {
    await run(store);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

test("토큰: 콜백이 세션 행에 암호문으로 두고, 로그아웃하면 디스코드에 폐기를 요청하고 행과 함께 지운다", () =>
  withStore(async (store) => {
    const discord = fakeDiscord();
    const { go } = await start(discord, { store });
    await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`);
    const sid = store.db.prepare("SELECT sid FROM sessions").pluck().get() as string;
    assert.equal(store.readDiscordToken(sid), "tok");

    discord.calls.length = 0;
    assert.equal((await go("/auth/logout", { method: "POST" })).status, 204);
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(
      discord.calls.map((c) => [c.url, c.body?.token, c.body?.token_type_hint]),
      [["https://discord.com/api/v10/oauth2/token/revoke", "tok", "access_token"]],
    );
    assert.equal(store.readDiscordToken(sid), null);
  }));

test("로그인 전에는 세션 행이 생기지 않는다. 로그인한 세션이 다시 로그인하러 와도(팝업) 그 세션은 그대로", () =>
  withStore(async (store) => {
    const WEEK = 7 * 24 * 60 * 60_000;
    const rows = () => store.db.prepare("SELECT expires_at FROM sessions").pluck().all() as number[];
    const { go } = await start(fakeDiscord(), { store, maxAge: WEEK });
    const state = stateOf(await go("/auth/login"));
    assert.deepEqual(rows(), [], "로그인 전 세션이 없다");
    await go(`/auth/callback?code=abc&state=${state}`);
    const [expires] = rows();
    assert.ok(expires > Date.now() + WEEK - 60_000, "로그인한 세션은 7일");
    await go("/auth/login?popup=1");
    const after = rows();
    assert.equal(after.length, 1);
    assert.ok(after[0] >= expires, "팝업 다시 로그인이 진짜 세션을 줄이지 않는다(요청 끝의 시각 늘리기만)");
  }));

test("콜백: 세션을 저장하지 못하면 로그인 실패로 돌려보내고, 로그인 쿠키도 세션 행도 남기지 않는다", () =>
  withStore(async (store) => {
    const { go, jar } = await start(fakeDiscord(), { store });
    const state = stateOf(await go("/auth/login"));
    const real = store._setStmt;
    store._setStmt = fake<typeof real>({
      run() {
        throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
      },
    });
    let res: globalThis.Response;
    try {
      res = await go(`/auth/callback?code=abc&state=${state}`);
    } finally {
      store._setStmt = real;
    }
    assert.equal(location(res), "/?error=auth_failed");
    assert.deepEqual(jar.names(), [], "세션 쿠키가 없다");
    assert.deepEqual(store.db.prepare("SELECT sid FROM sessions").all(), []);
    assert.equal(await (await go("/me")).json(), null);
  }));

test("팝업 다시 로그인: 디스코드를 기다리는 사이 다른 기기에서 옛 세션을 끊어도 새 로그인의 쿠키는 나간다", () =>
  withStore(async (store) => {
    let release: () => void = () => {};
    const hold = new Promise<void>((done) => (release = done));
    const discord = fakeDiscord();
    const { go, jar } = await start(discord, { store });
    await go(`/auth/callback?code=abc&state=${stateOf(await go("/auth/login"))}`);
    const old = jar.get(SESSION);
    const state = stateOf(await go("/auth/login?popup=1"));
    const held = fakeDiscord({ hold });
    discord.post = held.post;
    const answer = go(`/auth/callback?code=abc&state=${state}`);
    await new Promise((done) => setTimeout(done, 50));
    const oldSid = decodeURIComponent(old ?? "")
      .replace(/^s:/, "")
      .split(".")[0];
    store.destroy(oldSid);
    release();
    assert.equal(location(await answer), "/login-done");
    assert.ok(jar.get(SESSION) && jar.get(SESSION) !== old, "새 세션 쿠키");
    assert.deepEqual(await (await go("/me")).json(), { id: "u1", username: "user", globalName: "user", avatar: "av" });
  }));
