// src/dashboard/browser-side.ts: 브라우저 쪽 HTTPS 판정(신뢰하는 홉의 X-Forwarded-Proto, 소켓의 TLS, 공개 주소)과 HSTS

process.env.OWNER_ID = "owner";
process.env.DASHBOARD_TRUST_PROXY = "";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { baseUrl, listenForFetch } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("browser-side-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { browserSecure, browserSide, strictTransport } = await import("../../src/dashboard/browser-side.ts");

const servers: Array<{ close(): unknown }> = [];
after(() => {
  for (const s of servers) s.close();
  store.close();
});

/** 소켓 상대 peer, 소켓 TLS 여부, 헤더로 만든 가짜 요청. 신뢰하는 홉은 127.0.0.1 하나 */
function req(peer: string, headers: Record<string, string> = {}, encrypted = false) {
  const trust = (addr: string) => addr === "127.0.0.1";
  return fake<Request>({ app: { get: () => trust }, socket: { remoteAddress: peer, encrypted }, headers });
}

test("신뢰하는 홉의 X-Forwarded-Proto: 모두 https일 때만 https로 판정한다(Express는 첫 값만 본다)", () => {
  assert.equal(browserSecure(req("127.0.0.1", { "x-forwarded-proto": "https" }), false), true);
  assert.equal(browserSecure(req("127.0.0.1", { "x-forwarded-proto": "HTTPS, https" }), false), true);
  assert.equal(browserSecure(req("127.0.0.1", { "x-forwarded-proto": "https, http" }), false), false);
  assert.equal(browserSecure(req("127.0.0.1", { "x-forwarded-proto": "http" }, true), true), false, "헤더가 소켓 TLS와 공개 주소보다 앞선다");
});

test("신뢰하지 않는 홉의 X-Forwarded-Proto는 보지 않는다", () => {
  assert.equal(browserSecure(req("203.0.113.5", { "x-forwarded-proto": "https" }), false), false);
  assert.equal(browserSecure(req("203.0.113.5", { "x-forwarded-proto": "http" }, true), false), true, "소켓 TLS");
});

test("헤더가 없으면 소켓 TLS, 그다음 신뢰하는 홉일 때만 공개 주소의 https로 판정한다", () => {
  assert.equal(browserSecure(req("203.0.113.5", {}, true), false), true);
  assert.equal(browserSecure(req("127.0.0.1", {}), true), true, "X-Forwarded-Proto를 보내지 않는 프록시");
  assert.equal(browserSecure(req("127.0.0.1", { "x-forwarded-proto": " " }), true), true, "빈 헤더는 없는 것으로 본다");
  assert.equal(browserSecure(req("127.0.0.1", {}), false), false);
  assert.equal(browserSecure(req("203.0.113.5", {}), true), false, "브라우저가 바로 붙은 평문");
});

/** 작은 앱: 127.0.0.1을 신뢰하고 browserSide, strictTransport를 건 뒤 req.secure와 HSTS를 돌려준다 */
async function small(url: string) {
  const app = express();
  app.set("trust proxy", (addr: string) => addr === "127.0.0.1" || addr === "::ffff:127.0.0.1");
  app.use(browserSide(url), strictTransport(url));
  app.get("/", (r: Request, res: Response) => res.json({ secure: r.secure, protocol: r.protocol }));
  const server = await listenForFetch(app, "127.0.0.1");
  servers.push(server);
  return async (headers: Record<string, string>) => {
    const res = await fetch(`${baseUrl(server)}/`, { headers });
    return { ...((await res.json()) as { secure: boolean; protocol: string }), hsts: res.headers.get("strict-transport-security") };
  };
}

test("HSTS: 브라우저 쪽이 HTTPS이고 Host가 https 공개 주소의 호스트일 때만 max-age 1년으로 붙인다", async () => {
  const get = await small("https://Music.Example.com");
  assert.deepEqual(await get({ "x-forwarded-proto": "https", "x-forwarded-host": "music.example.com." }), { secure: true, protocol: "https", hsts: "max-age=31536000" });
  assert.equal((await get({ "x-forwarded-proto": "https", "x-forwarded-host": "music.example.com:443" })).hsts, "max-age=31536000", "포트는 보지 않는다");
  assert.equal((await get({ "x-forwarded-proto": "https", "x-forwarded-host": "other.example.com" })).hsts, null, "다른 이름");
  assert.equal((await get({ "x-forwarded-proto": "https" })).hsts, null, "127.0.0.1로 연 브라우저");
  assert.deepEqual(await get({ "x-forwarded-proto": "http", "x-forwarded-host": "music.example.com" }), { secure: false, protocol: "http", hsts: null });
  const plainUrl = await small("http://music.example.com");
  assert.equal((await plainUrl({ "x-forwarded-proto": "https", "x-forwarded-host": "music.example.com" })).hsts, null, "공개 주소가 http면 붙이지 않는다");
});

test("대시보드 앱: 신뢰하는 홉이 알린 HTTPS면 HSTS를 붙이고, 평문이면 붙이지 않는다", async () => {
  const saved = config.dashboard.url;
  config.dashboard.url = "https://music.example.com";
  try {
    const anonymous = (r: Request, _res: Response, next: NextFunction) => {
      r.session = fake<Request["session"]>({});
      next();
    };
    const app = createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: anonymous });
    const server = await listenForFetch(app, "127.0.0.1");
    servers.push(server);
    const https = await fetch(`${baseUrl(server)}/api/bot`, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "music.example.com" } });
    assert.equal(https.headers.get("strict-transport-security"), "max-age=31536000");
    for (const proto of ["http", "https, http"]) {
      const plain = await fetch(`${baseUrl(server)}/api/bot`, { headers: { "x-forwarded-proto": proto, "x-forwarded-host": "music.example.com" } });
      assert.equal(plain.headers.get("strict-transport-security"), null, proto);
    }
  } finally {
    config.dashboard.url = saved;
  }
});
