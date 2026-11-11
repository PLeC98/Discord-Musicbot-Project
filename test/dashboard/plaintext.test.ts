// src/dashboard/plaintext.ts: 인터넷 평문 막기. 요청마다 홉 검사와 브라우저 쪽 검사, 기동 시 공개 주소 검사(DNS)

process.env.OWNER_ID = "owner";
process.env.DASHBOARD_TRUST_PROXY = "";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { baseUrl, listenForFetch } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("plaintext-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { plaintextReason, checkPublicUrl } = await import("../../src/dashboard/plaintext.ts");
const { browserSecure } = await import("../../src/dashboard/browser-side.ts");
const { trustProxy } = await import("../../src/dashboard/client-ip.ts");
const { sessionCookieName } = await import("../../src/dashboard/cookies.ts");

const servers: Array<{ close(): unknown }> = [];
after(() => {
  for (const s of servers) s.close();
  store.close();
});

/** 소켓 상대, 소켓 TLS, 브라우저 쪽 HTTPS, 사용자 IP로 만든 가짜 요청 */
const req = (peer: string, { tls = false, secure = false, ip = peer }: { tls?: boolean; secure?: boolean; ip?: string } = {}) => fake<Request>({ socket: { remoteAddress: peer, encrypted: tls }, secure, ip, headers: {} });

test("홉 검사: 소켓이 평문이고 소켓 상대가 내부 주소가 아니면 막는다", () => {
  assert.equal(plaintextReason(req("203.0.113.5")), "hop");
  assert.equal(plaintextReason(req("::ffff:203.0.113.5")), "hop");
  assert.equal(plaintextReason(req("203.0.113.5", { tls: true, secure: true })), null, "TLS 소켓");
  for (const peer of ["127.0.0.1", "192.168.0.5", "100.101.1.2", "fd00::5"]) assert.equal(plaintextReason(req(peer)), null, peer);
});

test("브라우저 쪽 검사: 사용자 IP가 내부 주소가 아니고 브라우저 쪽이 http면 막는다", () => {
  assert.equal(plaintextReason(req("127.0.0.1", { ip: "203.0.113.9" })), "browser");
  assert.equal(plaintextReason(req("127.0.0.1", { ip: "203.0.113.9", secure: true })), null);
  assert.equal(plaintextReason(req("127.0.0.1", { ip: "192.168.0.9" })), null, "같은 네트워크의 평문은 막지 않는다");
});

const anonymous = (r: Request, _res: Response, next: NextFunction) => {
  r.session = fake<Request["session"]>({});
  next();
};
async function serve(allow: boolean) {
  const saved = config.dashboard.allowPlaintext;
  config.dashboard.allowPlaintext = allow;
  try {
    const server = await listenForFetch(createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: anonymous }), "127.0.0.1");
    servers.push(server);
    return (path: string, headers: Record<string, string>) => fetch(`${baseUrl(server)}${path}`, { headers }).then(async (r) => ({ status: r.status, body: await r.text() }));
  } finally {
    config.dashboard.allowPlaintext = saved;
  }
}

test("대시보드 앱: 인터넷 사용자의 평문은 화면 파일까지 403과 안내를 보내고, HTTPS나 같은 네트워크는 통과시킨다", async () => {
  const get = await serve(false);
  const internetPlain = await get("/api/bot", { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "http" });
  assert.equal(internetPlain.status, 403);
  assert.match(internetPlain.body, /평문/);
  assert.equal((await get("/", { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "http" })).status, 403, "화면 파일보다 앞");
  assert.equal((await get("/api/bot", { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" })).status, 200);
  assert.equal((await get("/api/bot", { "x-forwarded-for": "192.168.0.9" })).status, 200);
  assert.equal((await get("/api/bot", {})).status, 200, "이 기기");
});

test("DASHBOARD_ALLOW_PLAINTEXT면 막지 않는다", async () => {
  const get = await serve(true);
  assert.equal((await get("/api/bot", { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "http" })).status, 200);
});

test("기동 시 공개 주소 검사: http이고 공인 주소면 열지 않는다. https, 이 기기, 사설 주소는 연다", async () => {
  const lookup = (map: Record<string, string[]>) => async (host: string) => (map[host] ?? []).map((address) => ({ address }));
  const names = lookup({ "home.example.com": ["192.168.0.10"], "bot.example.com": ["192.168.0.10", "203.0.113.5"], "v6.example.com": ["2001:db8::5"] });
  assert.deepEqual(await checkPublicUrl("https://music.example.com", { lookup: names }), { open: true });
  assert.deepEqual(await checkPublicUrl("http://localhost:33333", { lookup: names }), { open: true });
  assert.deepEqual(await checkPublicUrl("http://192.168.0.10:33333", { lookup: names }), { open: true });
  assert.deepEqual(await checkPublicUrl("http://home.example.com:33333", { lookup: names }), { open: true });
  assert.equal((await checkPublicUrl("http://203.0.113.5:33333", { lookup: names })).open, false);
  assert.equal((await checkPublicUrl("http://[2001:db8::5]:33333", { lookup: names })).open, false);
  const mixed = await checkPublicUrl("http://bot.example.com:33333", { lookup: names });
  assert.equal(mixed.open, false, "조회된 주소 중 하나라도 공인");
  assert.match(mixed.open ? "" : mixed.detail, /bot\.example\.com → 203\.0\.113\.5/);
  assert.equal((await checkPublicUrl("http://v6.example.com", { lookup: names })).open, false);
});

test("기동 시 공개 주소 검사: 호스트를 찾지 못하거나 시간이 넘으면 막지 않고 까닭을 구별해 알린다", async () => {
  const notFound = await checkPublicUrl("http://nowhere.example.com", { lookup: () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })) });
  assert.equal(notFound.open, true);
  assert.match(notFound.open ? (notFound.note ?? "") : "", /찾지 못해/);
  const slow = await checkPublicUrl("http://slow.example.com", { lookup: () => new Promise(() => undefined), timeoutMs: 20 });
  assert.equal(slow.open, true);
  assert.match(slow.open ? (slow.note ?? "") : "", /0\.02초 안에 조회하지 못해/);
});

test("기동: 공개 주소가 인터넷 평문이면 대시보드를 열지 않고, 이 기기 주소면 127.0.0.1과 ::1에 열고 연 범위를 적는다", async () => {
  const { openDashboard } = await import("../../src/dashboard/index.ts");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const scopeFile = path.join(store.dir, "dashboard-scope.json");
  const app = createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: anonymous });
  const saved = { url: config.dashboard.url, port: config.dashboard.port, host: config.dashboard.host };
  try {
    const probe = await listenForFetch(app, "127.0.0.1");
    const port = (probe.address() as { port: number }).port;
    await new Promise((done) => probe.close(done));
    Object.assign(config.dashboard, { url: `http://203.0.113.5:${port}`, port, host: "127.0.0.1" });
    const blocked = await openDashboard(app, { scopeFile, container: false });
    servers.push(...blocked);
    assert.deepEqual(blocked, []);
    assert.equal(fs.existsSync(scopeFile), false);

    Object.assign(config.dashboard, { url: `http://localhost:${port}`, port, host: null });
    const opened = await openDashboard(app, { scopeFile, container: false });
    servers.push(...opened);
    assert.equal((opened[0].address() as { address: string }).address, "127.0.0.1");
    assert.ok(opened.length >= 1 && opened.length <= 2, "::1은 IPv6가 있을 때만");
    assert.deepEqual(JSON.parse(fs.readFileSync(scopeFile, "utf8")), { scope: "loopback" });
  } finally {
    Object.assign(config.dashboard, saved);
  }
});

// 접속 경로마다 막는지, 막지 않으면 어느 세션 쿠키 이름을 쓰는지 본다. 실제 앱과 같은 순서로 브라우저 쪽 판정(req.secure)을 먼저 하고, 평문 차단이 그 값을 본다.
// 사용자 IP(user)는 Express가 신뢰하는 홉의 X-Forwarded-For로 구한 값이다(신뢰하지 않는 홉이면 소켓의 상대 주소)
test("접속 경로별 판정: 신뢰하지 않는 공인 IP의 평문은 헤더와 상관없이 막고, __Host- 이름이 아닌 쿠키는 같은 네트워크의 평문과 평문 허용에서만 쓴다", () => {
  const { trust } = trustProxy("198.51.100.7");
  type Row = { peer: string; tls?: boolean; proto?: string; urlHttps?: boolean; user?: string; allow?: boolean; expect: "hop" | "browser" | "host" | "plain"; note: string };
  const rows: Row[] = [
    { peer: "203.0.113.5", expect: "hop", note: "신뢰하지 않는 공인 IP의 평문" },
    { peer: "203.0.113.5", proto: "https", expect: "hop", note: "신뢰하지 않는 홉의 X-Forwarded-Proto는 무시한다" },
    { peer: "203.0.113.5", urlHttps: true, expect: "hop", note: "공개 주소가 https여도 신뢰하지 않는 홉의 평문은 막는다" },
    { peer: "203.0.113.5", tls: true, expect: "host", note: "신뢰하지 않는 공인 IP의 TLS 소켓" },
    { peer: "203.0.113.5", tls: true, proto: "http", expect: "host", note: "신뢰하지 않는 홉의 X-Forwarded-Proto: http는 무시한다" },
    { peer: "198.51.100.7", proto: "https", user: "203.0.113.9", expect: "hop", note: "신뢰하는 공인 IP 프록시도 평문으로 붙으면 막는다" },
    { peer: "198.51.100.7", tls: true, proto: "https", user: "203.0.113.9", expect: "host", note: "신뢰하는 공인 IP 프록시의 TLS" },
    { peer: "198.51.100.7", tls: true, proto: "http", user: "203.0.113.9", expect: "browser", note: "신뢰하는 홉의 X-Forwarded-Proto: http가 소켓 TLS보다 우선한다" },
    { peer: "127.0.0.1", proto: "https", user: "203.0.113.9", expect: "host", note: "이 기기의 프록시가 전달한 https" },
    { peer: "127.0.0.1", proto: "http", user: "203.0.113.9", expect: "browser", note: "인터넷 사용자의 http를 이 기기의 프록시가 전달" },
    { peer: "127.0.0.1", urlHttps: true, user: "203.0.113.9", expect: "host", note: "신뢰하는 홉에 헤더가 없으면 https 공개 주소를 따른다" },
    { peer: "127.0.0.1", user: "203.0.113.9", expect: "browser", note: "신뢰하는 홉에 헤더 없음, http 공개 주소, 인터넷 사용자" },
    { peer: "192.168.0.5", expect: "plain", note: "같은 네트워크의 평문" },
    { peer: "100.101.1.2", expect: "plain", note: "Tailscale 망의 평문" },
    { peer: "fd00::5", expect: "plain", note: "IPv6 사설 주소의 평문" },
    { peer: "192.168.0.5", proto: "http", urlHttps: true, expect: "plain", note: "같은 네트워크의 프록시가 전달한 http" },
    { peer: "192.168.0.5", urlHttps: true, expect: "host", note: "같은 네트워크의 평문이라도 https 공개 주소면 Secure(브라우저가 받지 않아 로그인이 안 되는 차단하는 쪽, fail-closed)" },
    { peer: "203.0.113.5", allow: true, expect: "plain", note: "평문 허용" },
  ];
  for (const row of rows) {
    const base = { app: { get: () => trust }, socket: { remoteAddress: row.peer, encrypted: row.tls ?? false }, headers: row.proto ? { "x-forwarded-proto": row.proto } : {}, ip: row.user ?? row.peer };
    const secure = browserSecure(fake<Request>(base), row.urlHttps ?? false);
    const reason = row.allow ? null : plaintextReason(fake<Request>({ ...base, secure }));
    const got = reason ?? (sessionCookieName(secure).startsWith("__Host-") ? "host" : "plain");
    assert.equal(got, row.expect, row.note);
  }
});
