// src/dashboard/login-devices.ts, routes/login-devices.ts: 로그인한 기기 목록, 하나씩, 모두 로그아웃.
// 진짜 OAuth 경로(가짜 디스코드)로 쿠키 셋을 로그인시킨다: 같은 사용자 둘, 다른 사용자 하나. 세션은 임시 SQLite.

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createAuthRouter } from "../../src/dashboard/routes/auth.ts";
import { createLoginDevicesRouter } from "../../src/dashboard/routes/login-devices.ts";
import { noteDevice, openRecord, SEEN_EVERY_MS } from "../../src/dashboard/login-devices.ts";
import type { DiscordHttp } from "../../src/dashboard/discord-api.ts";
import { RECENT_LOGIN_MS } from "../../src/dashboard/middleware/recent-login.ts";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";
import type { LoginDevices, SignedOut } from "../../src/dashboard/contract/identity.ts";
import { fake } from "../helpers/fake.ts";
import * as listen from "../helpers/listen.ts";
import { cookieJar } from "../helpers/cookie-jar.ts";
import config from "../../src/config/index.ts";
import { sessionCookieName } from "../../src/dashboard/cookies.ts";
import * as sessionRequests from "../../src/dashboard/session-requests.ts";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-devices-"));
let store: SqliteSessionStore;
let server: Server;
let base: string;
const revoked: string[] = [];
let userId = "u1";
let release: () => void = () => {};
let held = Promise.resolve();
let holding: () => void = () => {};

before(async () => {
  secrets._useKey(newSecretsKey());
  store = new SqliteSessionStore({ dbPath: path.join(dir, "sessions.db") });
  // 가짜 디스코드: 로그인마다 다른 토큰, 사용자는 userId
  let n = 0;
  const http = fake<DiscordHttp>({
    async post(url: string, body: URLSearchParams) {
      if (url.endsWith("/revoke")) {
        revoked.push(String(body.get("token")));
        return { data: {} };
      }
      return { data: { access_token: `tok${++n}`, token_type: "Bearer" } };
    },
    async get() {
      return { data: { id: userId, username: userId, global_name: null, avatar: null } };
    },
  });
  const app = express();
  app.use(express.json());
  app.use(session({ name: sessionCookieName(false), secret: "test-secret", resave: false, saveUninitialized: false, rolling: true, store }));
  app.use(noteDevice);
  // x-change 헤더: 이 요청이 세션 내용을 바꾼다(요청이 끝날 때 express-session이 세션을 저장한다)
  app.use((req, _res, next) => {
    if (req.get("x-change") && req.session?.user) req.session.csrfToken = String(req.get("x-change"));
    next();
  });
  app.use(sessionRequests.bind);
  app.use("/auth", createAuthRouter({ http }));
  app.use("/api/me/devices", createLoginDevicesRouter({ places: { load: async () => true, locate: (ip) => ({ kind: "geo", city: `도시 ${ip}`, region: null, country: "대한민국" }) }, http }));
  // 세션을 바꾼 채 풀어 줄 때까지 대기하는 요청(훔친 쿠키로 시작해 둔 요청)
  app.post("/hold", async (_req, res) => {
    holding();
    await held;
    res.status(204).end();
  });
  // 같은 세션의 다른 요청이 바꾸는 값(운영자의 view-as)
  app.post("/view-as", (req, res) => {
    req.session.viewAs = "user";
    res.status(204).end();
  });
  // 로그인한 지 오래된 것처럼(최근 로그인 확인)
  app.post("/age-login", (req, res) => {
    req.session.loginAt = Date.now() - RECENT_LOGIN_MS - 1;
    res.status(204).end();
  });
  server = await listen.listenForFetch(app);
  base = listen.baseUrl(server);
  // 로그인은 공개 주소에서 시작한다(다른 origin이면 공개 주소로 리다이렉트한다). 이 테스트 서버를 공개 주소로 둔다
  config.dashboard.url = base;
});
after(() => {
  server.close();
  store.close();
  secrets._useKey();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

// 쿠키 하나 = 기기 하나
function device(ua: string) {
  const jar = cookieJar();
  const go = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie: jar.header(), "user-agent": ua, ...(init.headers as Record<string, string>) } });
    jar.take(res);
    return res;
  };
  const login = async (who: string) => {
    userId = who;
    const state = new URL((await go("/auth/login")).headers.get("location") ?? "").searchParams.get("state");
    await go(`/auth/callback?code=c&state=${state}`);
  };
  const list = async () => (await (await go("/api/me/devices")).json()) as LoginDevices;
  return { go, login, list, cookie: () => jar.header() };
}

test("목록은 같은 사용자의 세션만, 지금 기기가 맨 앞. 브라우저, OS, 기기 종류, 시각, 내부망 주소는 위치 DB 에 묻지 않는다", async () => {
  const pc = device(CHROME);
  const phone = device(IPHONE);
  const other = device(CHROME);
  await pc.login("u1");
  await phone.login("u1");
  await other.login("u2");

  const { devices, geoip } = await pc.list();
  assert.equal(geoip, true);
  assert.equal(devices.length, 2, "다른 사용자의 세션은 없다");
  assert.deepEqual(
    devices.map((d) => [d.current, d.known, d.browser, d.os, d.kind]),
    [
      [true, true, "Chrome", "Windows", "desktop"],
      [false, true, "Mobile Safari", "iOS", "mobile"],
    ],
  );
  assert.deepEqual(devices[0].place, { kind: "private" }, "테스트는 127.0.0.1 에서 온다");
  assert.ok(devices.every((d) => typeof d.signedInAt === "number" && typeof d.seenAt === "number"));
  assert.ok(
    devices.every((d) => d.id.length === 22 && !/sess/.test(d.id)),
    "세션 id 가 아니라 손잡이",
  );
});

test("기록은 세션 내용 밖의 표에 암호화해 둔다(IP가 평문으로 남지 않는다). 다른 행으로 옮기면 풀리지 않고, 세션 행을 지우면 함께 지워진다", () => {
  const rows = store.db.prepare("SELECT s.sid, s.data, d.device FROM sessions s JOIN session_devices d ON d.sid = s.sid").all() as Array<{ sid: string; data: string; device: Buffer }>;
  const [a, b] = rows;
  assert.equal("device" in JSON.parse(a.data), false, "세션 내용에는 없다");
  assert.doesNotMatch(a.device.toString("latin1"), /127\.0\.0\.1|Chrome/);
  assert.equal(openRecord(a.sid, a.device)?.ip.endsWith("127.0.0.1"), true);
  assert.equal(openRecord(b.sid, a.device), null);
  store.db.prepare("DELETE FROM sessions WHERE sid = ?").run(a.sid);
  assert.equal(store.readDevice(a.sid), null);
});

test("하나 끊기, 모두 끊기: 최근 로그인만, 끊는 세션의 디스코드 토큰 폐기 요청. 다른 사용자의 세션은 그대로, 지금 기기는 하나 끊기로 끊지 않는다", async () => {
  const pc = device(CHROME);
  const phone = device(IPHONE);
  const tablet = device(IPHONE);
  const other = device(CHROME);
  await pc.login("u3");
  await phone.login("u3");
  await tablet.login("u3");
  await other.login("u4");
  const [, second] = (await pc.list()).devices;

  // 최근 로그인이 아니면 거절
  await pc.go("/age-login", { method: "POST" });
  assert.equal((await pc.go(`/api/me/devices/${second.id}`, { method: "DELETE" })).status, 403);
  await pc.login("u3"); // 다시 로그인: 세션을 새로 만든다(옛 세션은 지워지고 기기 수는 그대로)

  const [self] = (await pc.list()).devices;
  assert.equal((await pc.go(`/api/me/devices/${self.id}`, { method: "DELETE" })).status, 404, "지금 기기는 여기서 끊지 않는다");
  assert.equal((await pc.go(`/api/me/devices/${second.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await pc.go(`/api/me/devices/${second.id}`, { method: "DELETE" })).status, 404, "이미 끊었다");

  revoked.length = 0;
  const all = await pc.go("/api/me/devices/sign-out-others", { method: "POST" });
  assert.deepEqual(await all.json(), { count: 1 });
  await new Promise((done) => setImmediate(done));
  assert.equal(revoked.length, 1, "끊은 세션마다 토큰 폐기");
  assert.equal((await pc.list()).devices.length, 1);
  for (const gone of [phone, tablet]) assert.equal((await gone.go("/api/me/devices")).status, 401, "끊긴 기기는 로그아웃됐다");
  assert.equal((await other.list()).devices.length, 1, "다른 사용자는 그대로");
});

test("기록이 없으면 다음 요청 때 현재 요청 정보로 만들고, 그 뒤로는 몇 분 간격으로만 다시 적는다", async () => {
  const pc = device(CHROME);
  await pc.login("u5");
  const sid = (store.sessionsOf("u5")[0] ?? { sid: "" }).sid;
  store.db.prepare("DELETE FROM session_devices WHERE sid = ?").run(sid);
  const listed = (await pc.list()).devices[0];
  assert.equal(listed.known, true, "목록을 부른 요청이 기록을 만들었다");
  const first = openRecord(sid, store.readDevice(sid));
  await pc.list();
  const again = openRecord(sid, store.readDevice(sid));
  assert.equal(again?.seenAt, first?.seenAt, `${SEEN_EVERY_MS}ms 안에는 다시 적지 않는다`);
});

test("로그인할 때 첫 기기 기록을 적지 못해도 로그인은 그대로 유지되고, 다음 요청에서 적는다", async (t) => {
  const pc = device(CHROME);
  const real = store.saveDevice.bind(store);
  let calls = 0;
  t.mock.method(store, "saveDevice", (...args: Parameters<typeof real>) => {
    if (++calls === 1) throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    return real(...args);
  });
  await pc.login("first-record");
  const [listed] = (await pc.list()).devices;
  assert.equal(calls, 2, "로그인에서 한 번, 다음 요청에서 한 번");
  assert.equal(listed?.known, true);
});

test("오래 걸리는 요청이 기다리는 사이 같은 세션에서 바꾼 값(view-as)은 그 요청이 끝나도 되돌아가지 않는다(기기 기록을 다시 적는 요청이 세션 전체를 저장하지 않는다)", async () => {
  const pc = device(CHROME);
  await pc.login("view-as-kept");
  const sid = store.sessionsOf("view-as-kept")[0]!.sid;
  let entered: () => void = () => {};
  const inside = new Promise<void>((done) => (entered = done));
  held = new Promise<void>((done) => (release = done));
  holding = entered;
  // 브라우저가 바뀌어 기기 기록을 다시 적는 요청
  const hanging = pc.go("/hold", { method: "POST", headers: { "user-agent": `${CHROME} Changed` } });
  await inside;
  try {
    assert.equal((await pc.go("/view-as", { method: "POST", headers: { "user-agent": `${CHROME} Changed` } })).status, 204);
  } finally {
    release();
  }
  await hanging;
  const [row] = store.sessionsOf("view-as-kept");
  assert.equal(row?.session.viewAs, "user");
  assert.match(openRecord(sid, row?.device)?.ua ?? "", /Changed/, "기기 기록은 표에 적었다");
});

// 훔친 쿠키로 시작해 둔 요청: 세션 내용을 바꿔(x-change) 그 요청이 끝날 때 세션을 저장한다
async function hangChanged(thief: ReturnType<typeof device>) {
  let entered: () => void = () => {};
  const inside = new Promise<void>((done) => (entered = done));
  held = new Promise<void>((done) => (release = done));
  holding = entered;
  const hanging = thief.go("/hold", { method: "POST", headers: { "x-change": "stolen" } });
  await inside;
  return { hanging }; // 그대로 돌려주면 await가 응답까지 기다린다
}

for (const how of ["다른 기기 로그아웃", "로그아웃"] as const) {
  test(`끊은 세션은 그 세션으로 진행 중이던 요청이 끝나도 되살아나지 않는다(${how})`, async () => {
    const who = how === "로그아웃" ? "revive-logout" : "revive-others";
    const pc = device(CHROME);
    const thief = device(IPHONE);
    await pc.login(who);
    const kept = new Set(store.sessionsOf(who).map(({ sid }) => sid));
    await thief.login(who);
    const stolen = store.sessionsOf(who).find(({ sid }) => !kept.has(sid))!.sid;
    const { hanging } = await hangChanged(thief);
    try {
      if (how === "다른 기기 로그아웃") assert.equal(((await (await pc.go("/api/me/devices/sign-out-others", { method: "POST" })).json()) as SignedOut).count, 1);
      else assert.equal((await thief.go("/auth/logout", { method: "POST" })).status, 204);
    } finally {
      release();
    }
    await hanging;
    assert.equal((await thief.go("/api/me/devices")).status, 401, "끊은 쿠키는 다시 쓸 수 없다");
    assert.equal(store.sessionsOf(who).length, 1, "남은 것은 끊지 않은 기기뿐");
    assert.equal(store.db.prepare("SELECT sid FROM sessions WHERE sid = ?").get(stolen), undefined, "진행 중이던 요청이 끝나도 로그아웃한 세션이 DB에 다시 저장되지 않는다");
  });
}

// 저장소의 삭제만 실패하게 한다(디스크가 가득 참). 되돌리는 함수를 돌려준다
function breakDelete() {
  const real = store._deleteStmt;
  store._deleteStmt = fake<typeof real>({
    get() {
      throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    },
  });
  return () => (store._deleteStmt = real);
}

type Unsaved = { code: string; signedOutCount: number; unsavedCount: number };

test("다른 기기 로그아웃의 삭제가 실패하면 성공으로 답하지 않는다(503, 실패 건수). 이 기기의 이전 세션도 지우지 못해 이 기기도 로그아웃되고, 끊은 쿠키는 이 실행에서 곧바로 401, DB가 돌아오면 다시 삭제한다", async () => {
  const pc = device(CHROME);
  const phone = device(IPHONE);
  await pc.login("unsaved1");
  await phone.login("unsaved1");
  const restore = breakDelete();
  try {
    const res = await pc.go("/api/me/devices/sign-out-others", { method: "POST" });
    assert.equal(res.status, 503);
    const body = (await res.json()) as Unsaved;
    assert.deepEqual([body.code, body.signedOutCount, body.unsavedCount], ["sign-out-unsaved", 0, 2], "다른 기기 하나와 이 기기의 이전 세션");
    assert.deepEqual(res.headers.getSetCookie(), [], "새 세션 쿠키를 싣지 않는다");
    assert.equal((await phone.go("/api/me/devices")).status, 401, "끊은 쿠키는 이 실행에서 쓸 수 없다");
    assert.equal((await pc.go("/api/me/devices")).status, 401, "이 기기도 로그아웃됐다");
    assert.equal(store.unsavedOf("unsaved1").length, 2);
  } finally {
    restore();
  }
  await pc.login("unsaved1");
  const again = await pc.go("/api/me/devices/sign-out-others", { method: "POST" });
  assert.equal(again.status, 200, "DB가 돌아오면 삭제한다");
  assert.equal(store.sessionsOf("unsaved1").length, 1);
  assert.equal(store.unsavedOf("unsaved1").length, 0);
});

test("로그아웃의 삭제가 실패해도 쿠키는 삭제하고 503. 그 쿠키는 이 실행에서 401", async () => {
  const pc = device(CHROME);
  await pc.login("unsaved2");
  const before = await pc.go("/api/me/devices");
  assert.equal(before.status, 200);
  const restore = breakDelete();
  let res: Response;
  try {
    res = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie: pc.cookie(), "user-agent": CHROME } });
  } finally {
    restore();
  }
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as Unsaved).code, "sign-out-unsaved");
  assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`${sessionCookieName(false)}=;.*Expires=Thu, 01 Jan 1970`), "이 브라우저의 쿠키를 삭제한다");
  assert.equal((await pc.go("/api/me/devices")).status, 401);
  assert.equal(store.unsavedOf("unsaved2").length, 1, "그 사용자의 삭제하지 못한 세션으로 남겨 둔다(다른 기기 로그아웃이 다시 삭제한다)");
  store.retryUnsaved();
});

test("끊을 세션의 디스코드 토큰을 읽지 못해도(DB 오류) 세션은 끊는다", async () => {
  const pc = device(CHROME);
  const phone = device(IPHONE);
  await pc.login("token-throws");
  await phone.login("token-throws");
  const real = store.readDiscordToken;
  store.readDiscordToken = () => {
    throw new Error("database is locked");
  };
  try {
    assert.equal(((await (await pc.go("/api/me/devices/sign-out-others", { method: "POST" })).json()) as SignedOut).count, 1);
  } finally {
    store.readDiscordToken = real;
  }
  assert.equal((await phone.go("/api/me/devices")).status, 401);
});

test("다른 기기 로그아웃은 로그인한 지 2분 안이어야 한다(거의 언제나 로그인 창을 거쳐 이 기기의 세션 id도 바뀐다)", async () => {
  const pc = device(CHROME);
  const phone = device(IPHONE);
  await pc.login("two-minutes");
  await phone.login("two-minutes");
  // 두 기기 모두 3분 전에 로그인한 것처럼(최근 로그인 10분 안, 다른 기기 로그아웃의 2분 밖)
  for (const { sid, session } of store.sessionsOf("two-minutes")) store.set(sid, { ...session, loginAt: Date.now() - 3 * 60_000 });
  const late = await pc.go("/api/me/devices/sign-out-others", { method: "POST" });
  assert.equal(late.status, 403);
  assert.equal(((await late.json()) as { code: string }).code, "reauth-required");
  assert.equal(store.sessionsOf("two-minutes").length, 2, "끊지 않았다");
});

// ── 다른 기기 로그아웃은 이 기기도 새 세션 id로 옮긴다 ──

// 이 쿠키를 그대로 복사해 간 쪽
const copied =
  (cookie: string) =>
  (p: string, init: RequestInit = {}) =>
    fetch(base + p, { redirect: "manual", ...init, headers: { cookie, "user-agent": CHROME, ...(init.headers as Record<string, string>) } });
const rowData = (sid: string) => JSON.parse(store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(sid) as string) as { loginAt: number; viewAs?: string; csrfToken?: string };

test("로그인 뒤 2분 안에 복사한 쿠키도 다른 기기 로그아웃 뒤에는 401이다. 이 기기는 새 쿠키로 로그인이 이어지고 로그인 시각, view-as, 디스코드 토큰, 기기 기록을 옮기며 CSRF 토큰은 새로 만든다", async () => {
  const pc = device(CHROME);
  await pc.login("rotate");
  await pc.go("/view-as", { method: "POST", headers: { "x-change": "old-token" } });
  const [before] = store.sessionsOf("rotate");
  const oldSid = before!.sid;
  const was = { data: rowData(oldSid), token: store.readDiscordToken(oldSid), record: openRecord(oldSid, store.readDevice(oldSid)) };
  const thief = copied(pc.cookie());
  assert.equal((await thief("/api/me/devices")).status, 200, "복사한 쿠키는 이 기기와 같은 세션이다");

  const res = await pc.go("/api/me/devices/sign-out-others", { method: "POST" });
  assert.deepEqual(await res.json(), { count: 0 });
  assert.equal((await thief("/api/me/devices")).status, 401, "복사한 쿠키는 끊겼다");
  assert.equal(store.db.prepare("SELECT sid FROM sessions WHERE sid = ?").get(oldSid), undefined, "이전 세션 행은 없다");

  const [after] = store.sessionsOf("rotate");
  assert.ok(after && after.sid !== oldSid, "새 세션 id");
  assert.equal(store.sessionsOf("rotate").length, 1);
  const now = rowData(after.sid);
  assert.deepEqual([now.loginAt, now.viewAs], [was.data.loginAt, "user"], "로그인 시각(절대 기한이 늘지 않게)과 view-as는 그대로");
  assert.equal(was.data.csrfToken, "old-token");
  assert.equal(now.csrfToken, undefined, "CSRF 토큰은 옮기지 않는다(다음 요청이 새로 받는다)");
  assert.equal(store.readDiscordToken(after.sid), was.token);
  assert.equal(openRecord(after.sid, store.readDevice(after.sid))?.signedInAt, was.record?.signedInAt, "기기 기록의 로그인 시각도 그대로");
  assert.equal((await pc.go("/api/me/devices")).status, 200, "이 기기는 새 쿠키로 이어진다");
});

test("같은 쿠키로 다른 기기 로그아웃을 동시에 두 번 누르면 하나만 새 세션을 받고 다른 하나는 401이다. 그 사용자의 살아 있는 세션은 하나다", async () => {
  const pc = device(CHROME);
  await pc.login("rotate-twice");
  const twin = copied(pc.cookie());
  const [a, b] = await Promise.all([pc.go("/api/me/devices/sign-out-others", { method: "POST" }), twin("/api/me/devices/sign-out-others", { method: "POST" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 401]);
  const loser = a.status === 401 ? a : b;
  assert.deepEqual(loser.headers.getSetCookie(), [], "진 쪽은 쿠키를 싣지 않는다");
  assert.equal(store.sessionsOf("rotate-twice").length, 1);
});

test("이전 세션 id로 나가 있던 요청은 세션 id를 바꾼 뒤 끝나도 이전 쿠키를 싣지 않는다(새 쿠키를 덮지 않는다)", async () => {
  const pc = device(CHROME);
  await pc.login("rotate-inflight");
  let entered: () => void = () => {};
  const inside = new Promise<void>((done) => (entered = done));
  held = new Promise<void>((done) => (release = done));
  holding = entered;
  const hanging = copied(pc.cookie())("/hold", { method: "POST" });
  await inside;
  try {
    assert.equal((await pc.go("/api/me/devices/sign-out-others", { method: "POST" })).status, 200);
  } finally {
    release();
  }
  assert.deepEqual((await hanging).headers.getSetCookie(), []);
  assert.equal((await pc.go("/api/me/devices")).status, 200);
});

test("새 세션을 저장하지 못하면 이 기기도 로그아웃이다(401, 쿠키 없음, 남은 세션 없음)", async (t) => {
  const pc = device(CHROME);
  await pc.login("rotate-fails");
  t.mock.method(store, "saveDiscordToken", () => false);
  const res = await pc.go("/api/me/devices/sign-out-others", { method: "POST" });
  t.mock.restoreAll();
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { code: string }).code, "login-required");
  assert.deepEqual(res.headers.getSetCookie(), []);
  assert.equal((await pc.go("/api/me/devices")).status, 401);
  assert.deepEqual(store.sessionsOf("rotate-fails"), []);
});
