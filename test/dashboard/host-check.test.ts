// src/dashboard/host-check.ts: 허용하는 호스트로 온 요청만 처리한다(DNS 리바인딩). Host 헤더, 절대 형식 요청 대상의 호스트, 신뢰하는 홉이면 X-Forwarded-Host의 모든 값을 검사한다

process.env.OWNER_ID = "owner";
process.env.DASHBOARD_TRUST_PROXY = "";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { listenForFetch } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("host-check-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { normalizeHost, allowedHost, hostCheck } = await import("../../src/dashboard/host-check.ts");
const { warnGate } = await import("../../src/dashboard/warn-gate.ts");

const servers: Array<{ close(): unknown }> = [];
after(() => {
  for (const s of servers) s.close();
  store.close();
});

test("normalizeHost: 소문자, IDNA, 포트와 끝의 점 제거, IPv6 대괄호로 정규화하고, 사용자 정보, 경로, 공백, %, 쉼표, 잘못된 포트는 null을 반환한다", () => {
  const cases: Array<[string, string | null]> = [
    ["Music.Example.COM.", "music.example.com"],
    ["music.example.com:443", "music.example.com"],
    ["[::1]:33333", "[::1]"],
    ["127.0.0.1:33333", "127.0.0.1"],
    ["bücher.de", "xn--bcher-kva.de"],
    ["evil.com@localhost", null],
    ["localhost/x", null],
    ["a b", null],
    ["%6cocalhost", null],
    ["x,y", null],
    ["localhost:99999", null],
    ["", null],
  ];
  for (const [value, want] of cases) assert.equal(normalizeHost(value), want, value);
});

test("allowedHost: 공개 주소의 호스트, localhost, IP, 점 없는 호스트 이름, 로컬 도메인만 허용한다", () => {
  for (const host of ["music.example.com", "localhost", "app.localhost", "127.0.0.1", "192.168.0.10", "[::1]", "[fd00::1]", "mypc", "nas.local", "a.home.arpa", "bot.internal", "router.lan"]) assert.equal(allowedHost(host, "music.example.com"), true, host);
  for (const host of ["evil.com", "music.example.com.evil.com", "localhost.evil.com", "lan.evil.com", "xn--bcher-kva.de"]) assert.equal(allowedHost(host, "music.example.com"), false, host);
  assert.equal(allowedHost("music.example.com", null), false, "공개 주소가 없으면 외부 도메인은 허용하지 않는다");
});

/** 원시 HTTP 요청을 보내고 상태 코드와 본문을 돌려준다(fetch는 Host를 바꿀 수 없다). 요청을 쓴 뒤 소켓을 먼저 닫지 않는다(닫으면 대시보드가 끊긴 연결로 보고 응답하지 않는다) */
function raw(port: number, head: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(`${head}\r\nConnection: close\r\n\r\n`));
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (data += chunk));
    socket.on("end", () => resolve({ status: Number(/^HTTP\/1\.\d (\d+)/.exec(data)?.[1] ?? 0), body: data.slice(data.indexOf("\r\n\r\n") + 4) }));
    socket.on("error", reject);
  });
}

test("대시보드 앱: 허용하지 않은 Host, 요청 대상, X-Forwarded-Host와 Host가 없거나 여러 개인 요청에는 세션 전에 403과 안내를 보낸다", async () => {
  const saved = config.dashboard.url;
  config.dashboard.url = "https://music.example.com";
  try {
    let reached = 0;
    const anonymous = (r: Request, _res: Response, next: NextFunction) => {
      reached += 1;
      r.session = fake<Request["session"]>({});
      next();
    };
    const app = createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: anonymous });
    const server = await listenForFetch(app, "127.0.0.1");
    servers.push(server);
    const port = (server.address() as net.AddressInfo).port;
    const get = (headers: string) => raw(port, `GET /api/bot HTTP/1.1\r\n${headers}`);

    for (const host of ["music.example.com", "MUSIC.example.com.:443", "127.0.0.1:1", "localhost", "mypc", "nas.local"]) assert.equal((await get(`Host: ${host}`)).status, 200, host);
    assert.equal((await get("Host: 127.0.0.1\r\nX-Forwarded-Host: music.example.com")).status, 200);

    const before = reached;
    const evil = await get("Host: evil.com");
    assert.equal(evil.status, 403);
    assert.match(evil.body, /evil\.com/);
    assert.match(evil.body, /DASHBOARD_URL/);
    assert.equal((await raw(port, "GET / HTTP/1.1\r\nHost: evil.com")).status, 403, "화면 파일보다 앞");
    assert.equal((await get("Host: 127.0.0.1\r\nX-Forwarded-Host: music.example.com, evil.com")).status, 403, "X-Forwarded-Host의 모든 값");
    assert.equal((await get("Host: evil.com\r\nX-Forwarded-Host: localhost")).status, 403, "리바인딩 페이지가 붙인 X-Forwarded-Host로 Host를 덮어쓰지 못한다");
    assert.equal((await raw(port, "GET http://evil.com/api/bot HTTP/1.1\r\nHost: localhost")).status, 403, "절대 형식 요청 대상의 호스트");

    assert.equal((await get("Host: localhost\r\nHost: evil.com")).status, 403, "Host가 여러 개");
    assert.equal((await raw(port, "GET /api/bot HTTP/1.0")).status, 403, "Host가 없다");
    assert.equal(reached, before, "막은 요청은 세션까지 가지 않는다");
    assert.equal((await raw(port, "GET http://localhost/api/bot HTTP/1.1\r\nHost: localhost")).status, 200);
    assert.equal((await get("Host: 127.0.0.1\r\nX-Forwarded-Host: ")).status, 200, "빈 X-Forwarded-Host는 없는 것으로 본다");
  } finally {
    config.dashboard.url = saved;
  }
});

test("신뢰하지 않는 홉의 X-Forwarded-Host는 보지 않는다(그 값으로 막지도 않는다)", () => {
  const req = fake<Request>({ app: { get: () => () => false }, url: "/", socket: { remoteAddress: "203.0.113.5" }, rawHeaders: ["Host", "music.example.com", "X-Forwarded-Host", "evil.com"], headers: { host: "music.example.com", "x-forwarded-host": "evil.com" } });
  let passed = false;
  hostCheck("https://music.example.com")(req, fake<Response>({}), () => (passed = true));
  assert.equal(passed, true);
});

test("차단 경고: 같은 호스트는 1시간에 한 번, 1시간에 32개까지. 상한에 닿으면 한 줄을 더 남기고, 1시간이 지나면 다시 센다", () => {
  let now = 0;
  const gate = warnGate(() => now);
  assert.equal(gate("Host:a"), "warn");
  assert.equal(gate("Host:a"), "skip");
  for (let i = 1; i < 32; i++) assert.equal(gate(`Host:h${i}`), "warn");
  assert.equal(gate("Host:over"), "cap");
  assert.equal(gate("Host:over2"), "skip");
  now = 60 * 60_000;
  assert.equal(gate("Host:a"), "warn");
  assert.equal(gate("Host:over"), "warn");
});
