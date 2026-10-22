// src/dashboard/login-devices.ts · routes/login-devices.ts — 로그인한 기기 목록 · 하나씩 · 모두 로그아웃.
// 진짜 OAuth 경로(가짜 디스코드)로 쿠키 셋을 로그인시킨다: 같은 사용자 둘 · 다른 사용자 하나. 세션은 임시 SQLite.

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
import type { LoginDevices } from "../../src/dashboard/contract/identity.ts";
import { fake } from "../helpers/fake.ts";
import * as listen from "../helpers/listen.ts";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-devices-"));
let store: SqliteSessionStore;
let server: Server;
let base: string;
const revoked: string[] = [];
let userId = "u1";

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
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, store }));
  app.use(noteDevice);
  app.use("/auth", createAuthRouter({ http }));
  app.use("/api/me/devices", createLoginDevicesRouter({ locate: (ip) => ({ kind: "geo", city: `도시 ${ip}`, region: null, country: "KR" }), geoip: () => true, http }));
  // 로그인한 지 오래된 것처럼(최근 로그인 확인)
  app.post("/age-login", (req, res) => {
    req.session.loginAt = Date.now() - RECENT_LOGIN_MS - 1;
    res.status(204).end();
  });
  server = await listen.listenForFetch(app);
  base = listen.baseUrl(server);
});
after(() => {
  server.close();
  store.close();
  secrets._useKey();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

// 쿠키 하나 = 기기 하나
function device(ua: string) {
  let cookie = "";
  const go = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie, "user-agent": ua, ...(init.headers as Record<string, string>) } });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  };
  const login = async (who: string) => {
    userId = who;
    const state = new URL((await go("/auth/login")).headers.get("location") ?? "").searchParams.get("state");
    await go(`/auth/callback?code=c&state=${state}`);
  };
  const list = async () => (await (await go("/api/me/devices")).json()) as LoginDevices;
  return { go, login, list };
}

test("목록은 같은 사용자의 세션만, 지금 기기가 맨 앞. 브라우저 · OS · 기기 종류 · 시각, 내부망 주소는 위치 DB 에 묻지 않는다", async () => {
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
  assert.deepEqual(devices[0].place, { kind: "private" }, "시험은 127.0.0.1 에서 온다");
  assert.ok(devices.every((d) => typeof d.signedInAt === "number" && typeof d.seenAt === "number"));
  assert.ok(
    devices.every((d) => d.id.length === 22 && !/sess/.test(d.id)),
    "세션 id 가 아니라 손잡이",
  );
});

test("기록은 세션 내용에 봉해 둔다(IP 가 평문으로 남지 않는다). 다른 행으로 옮기면 풀리지 않는다", () => {
  const rows = store.db.prepare("SELECT sid, data FROM sessions").all() as Array<{ sid: string; data: string }>;
  const [a, b] = rows;
  const sealed = (JSON.parse(a.data) as { device: string }).device;
  assert.doesNotMatch(a.data, /127\.0\.0\.1|Chrome/);
  assert.equal(openRecord(a.sid, sealed)?.ip.endsWith("127.0.0.1"), true);
  assert.equal(openRecord(b.sid, sealed), null);
});

test("하나 끊기 · 모두 끊기: 최근 로그인만, 끊는 세션의 디스코드 토큰 폐기 요청. 다른 사용자의 세션은 그대로, 지금 기기는 하나 끊기로 끊지 않는다", async () => {
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

test("이 기능 전의 세션: 기록이 없으면 다음 요청 때 지금 것으로 만들고, 그 뒤로는 몇 분마다만 다시 적는다", async () => {
  const pc = device(CHROME);
  await pc.login("u5");
  const sid = (store.sessionsOf("u5")[0] ?? { sid: "" }).sid;
  // 기록을 지운다(기능 전 세션)
  const row = store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(sid) as string;
  const data = JSON.parse(row) as Record<string, unknown>;
  delete data.device;
  store.db.prepare("UPDATE sessions SET data = ? WHERE sid = ?").run(JSON.stringify(data), sid);
  const listed = (await pc.list()).devices[0];
  assert.equal(listed.known, true, "목록을 부른 요청이 기록을 만들었다");
  const first = openRecord(sid, (JSON.parse(store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(sid) as string) as { device: string }).device);
  await pc.list();
  const again = openRecord(sid, (JSON.parse(store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(sid) as string) as { device: string }).device);
  assert.equal(again?.seenAt, first?.seenAt, `${SEEN_EVERY_MS}ms 안에는 다시 적지 않는다`);
});
