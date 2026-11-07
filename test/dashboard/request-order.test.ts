// src/dashboard/index.ts, rate-limits.ts, body-limit.ts, binding.ts: 요청이 비싼 작업(본문 파싱, 라우트 핸들러)에 닿기 전에 요청 수를 세고,
// 검사를 다 통과한 요청만 본문을 받는다. 본문을 다 받지 않은 채 응답하면 연결을 닫고, 100-continue는 검사를 통과한 뒤에만 보낸다

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { baseUrl, listenForFetch } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("request-order-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { listen } = await import("../../src/dashboard/binding.ts");
const { tooManyRequests } = await import("../../src/dashboard/problem.ts");
const { CSRF_TOKEN_MAX } = await import("../../src/dashboard/rate-limits.ts");

const TOKEN = "t".repeat(43);
let user: object | null = null;
// 실제 앱의 세션 미들웨어를 대신한다: 로그인한 사용자(user)와 CSRF 토큰을 넣는다
const fakeSession = (req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({ user: user ?? undefined, loginAt: Date.now(), csrfToken: TOKEN, destroy: (done: () => void) => done() });
  next();
};
const appOf = () => createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: fakeSession });

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
  store.close();
});
// 한도마다 앱을 새로 띄운다(센 수가 섞이지 않게)
async function fresh() {
  const server = await listenForFetch(appOf(), "127.0.0.1");
  servers.push(server);
  const base = baseUrl(server);
  return (path: string, init: RequestInit = {}) => fetch(base + path, { signal: AbortSignal.timeout(3000), ...init }).then(async (res) => ({ status: res.status, text: await res.text() }));
}
async function withLimits<T>(limits: Partial<typeof config.dashboard.rateLimit>, fn: () => Promise<T>) {
  const saved = { ...config.dashboard.rateLimit };
  Object.assign(config.dashboard.rateLimit, limits);
  try {
    return await fn();
  } finally {
    Object.assign(config.dashboard.rateLimit, saved);
    user = null;
  }
}
const SIGNED_IN = { id: "u1", username: "u1" };

test("익명 사용자의 상태 변경 요청은 본문을 파싱하기 전에 요청 수를 세어 한도를 넘으면 429를 반환한다(CSRF 403이 먼저가 아니다)", () =>
  withLimits({ apiMax: 2 }, async () => {
    const server = await listenForFetch(appOf(), "127.0.0.1");
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    // 원시 소켓으로: 서버는 본문을 다 받지 않고 답하고 닫으므로, 올리는 도중에 끊긴 것을 실패로 보는 fetch 대신 받은 응답 줄을 본다
    const big = JSON.stringify({ x: "y".repeat(500_000) });
    const put = async () => (await raw(port, `PUT /api/admin/ai/settings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${big.length}\r\n\r\n`, big)).got.slice(0, 12);
    assert.deepEqual([await put(), await put()], ["HTTP/1.1 403", "HTTP/1.1 403"]);
    assert.equal(await put(), "HTTP/1.1 429");
  }));

test("한도 제외 경로도 익명 요청, 다른 메서드는 센다. 로그인한 사용자의 GET은 빼 준다", () =>
  withLimits({ apiMax: 2 }, async () => {
    const anon = await fresh();
    const search = () => anon("/api/guilds/1/player/search?q=x");
    assert.notEqual((await search()).status, 429);
    assert.notEqual((await search()).status, 429);
    assert.equal((await search()).status, 429, "익명은 센다");

    user = SIGNED_IN;
    const signed = await fresh();
    const post = () => signed("/api/guilds/1/player/search", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": TOKEN }, body: JSON.stringify({ x: "y".repeat(20_000) }) });
    await post();
    await post();
    assert.equal((await post()).status, 429, "로그인했어도 검색 경로에 POST는 센다");
  }));

test("일반 한도가 차도 로그인한 사용자는 토큰을 받는다. 토큰 받기에도 따로 한도가 있다", () =>
  withLimits({ apiMax: 1 }, async () => {
    user = SIGNED_IN;
    const at = await fresh();
    await at("/api/me");
    assert.equal((await at("/api/me")).status, 429, "일반 한도가 찼다");
    for (let i = 0; i < CSRF_TOKEN_MAX; i++) assert.equal((await at("/api/csrf-token")).status, 200, `토큰 ${i + 1}`);
    assert.equal((await at("/api/csrf-token")).status, 429);
  }));

test("로그인 한도가 차도 로그인한 사용자의 로그아웃은 된다", () =>
  withLimits({ authMax: 1 }, async () => {
    const at = await fresh();
    await at("/auth/login");
    assert.equal((await at("/auth/login")).status, 429, "로그인 한도가 찼다");
    user = SIGNED_IN;
    assert.notEqual((await at("/auth/logout", { method: "POST", headers: { "x-csrf-token": TOKEN } })).status, 429);
  }));

test("세션 미들웨어 앞에서 응답하는 /api의 공개 경로(로그인 배경 목록)도 공개 한도에 센다(끝의 /, 대문자도)", () =>
  withLimits({ publicMax: 2 }, async () => {
    const at = await fresh();
    assert.notEqual((await at("/api/login-background")).status, 429);
    assert.notEqual((await at("/api/login-background/")).status, 429);
    assert.equal((await at("/API/LOGIN-BACKGROUND")).status, 429);
  }));

/** 원시 소켓으로 요청을 보내고, 수신한 응답 문자열과 서버가 연결을 닫았는지를 돌려준다 */
async function raw(port: number, head: string, body = "", { waitMs = 1500 } = {}) {
  const socket = net.connect(port, "127.0.0.1");
  await once(socket, "connect");
  let got = "";
  let closed = false;
  socket.on("data", (d) => (got += d.toString("latin1")));
  socket.on("close", () => (closed = true));
  socket.on("error", () => {});
  socket.write(head + body);
  const deadline = Date.now() + waitMs;
  while (!closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  socket.destroy();
  return { got, closed };
}

test("본문을 다 받지 않은 채 응답하면 연결을 닫는다(거절, 본문을 읽지 않는 GET, 청크 본문). 본문을 다 받은 요청은 연결을 이어 쓴다", async () => {
  const server = await listenForFetch(appOf(), "127.0.0.1");
  servers.push(server);
  const port = (server.address() as AddressInfo).port;

  const rejected = await raw(port, "PUT /api/admin/ai/settings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 10000000\r\n\r\n", "{");
  assert.match(rejected.got, /^HTTP\/1\.1 403/);
  assert.match(rejected.got, /connection: close/i);
  assert.equal(rejected.closed, true, "남은 본문을 기다리지 않고 닫는다");

  const chunked = await raw(port, "POST /api/me HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n", "5\r\nhello\r\n");
  assert.equal(chunked.closed, true);

  // 남은 본문이 작으면 받아 버리고 연결을 이어 쓴다(올리는 도중의 브라우저도 연결 끊김이 아니라 답을 받는다)
  const small = JSON.stringify({ x: "y".repeat(20_000) });
  const kept = await raw(port, `PUT /api/admin/ai/settings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${small.length}\r\n\r\n`, small, { waitMs: 500 });
  assert.match(kept.got, /^HTTP\/1\.1 403/);
  assert.doesNotMatch(kept.got, /connection: close/i);
  assert.equal(kept.closed, false);

  user = SIGNED_IN;
  try {
    const ignored = await raw(port, "GET /api/csrf-token HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n", "{ not json");
    assert.match(ignored.got, /^HTTP\/1\.1 200/);
    assert.equal(ignored.closed, true, "본문을 읽지 않는 GET도 남은 본문을 기다리지 않고 닫는다");
    // 본문 파싱 미들웨어 뒤의 GET 경로: 본문을 다 보내도 파싱하지 않는다(잘못된 JSON이어도 400이 아니다)
    const body = "{ not json";
    const unparsed = await raw(port, `GET /api/me HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`, body);
    assert.match(unparsed.got, /^HTTP\/1\.1 200/, "GET의 본문은 파싱하지 않는다");
  } finally {
    user = null;
  }

  const whole = await raw(port, `GET /api/bot HTTP/1.1\r\nHost: x\r\n\r\n`, "", { waitMs: 500 });
  assert.match(whole.got, /^HTTP\/1\.1 200/);
  assert.equal(whole.closed, false, "본문이 없는 요청은 연결을 이어 쓴다");
});

test("100-continue: 검사에 걸리면 100 없이 거절하고, 통과하면 100을 보내고 본문을 받는다", async () => {
  const server = listen(appOf(), { host: "127.0.0.1", port: 0, url: "http://localhost" });
  servers.push(server);
  if (!server.listening) await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  const rejected = await raw(port, "PUT /api/admin/ai/settings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\nExpect: 100-continue\r\n\r\n");
  assert.doesNotMatch(rejected.got, /100 Continue/);
  assert.match(rejected.got, /^HTTP\/1\.1 403/);
  assert.equal(rejected.closed, true);

  user = SIGNED_IN;
  try {
    const over = await raw(port, `POST /api/guilds/1/player/queue HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2000000\r\nExpect: 100-continue\r\nx-csrf-token: ${TOKEN}\r\n\r\n`);
    assert.doesNotMatch(over.got, /100 Continue/, "상한을 넘는 본문에는 100을 보내지 않는다");
    assert.match(over.got, /^HTTP\/1\.1 413/);

    const socket = net.connect(port, "127.0.0.1");
    await once(socket, "connect");
    let got = "";
    socket.on("data", (d) => (got += d.toString("latin1")));
    const body = "{ not json";
    socket.write(`POST /api/guilds/1/player/queue HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nExpect: 100-continue\r\nx-csrf-token: ${TOKEN}\r\n\r\n`);
    const deadline = Date.now() + 2000;
    while (!/100 Continue/.test(got) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.match(got, /^HTTP\/1\.1 100 Continue/, "검사를 지나면 100");
    socket.write(body);
    while (!/HTTP\/1\.1 400/.test(got) && Date.now() < deadline + 2000) await new Promise((r) => setTimeout(r, 20));
    assert.match(got, /HTTP\/1\.1 400/, "본문을 받아 파싱했다(잘못된 JSON)");
    socket.destroy();
  } finally {
    user = null;
  }
});

test("본문은 /api만 파싱한다(로그아웃은 잘못된 JSON이어도 400이 아니다). 운영자가 아닌 사용자의 앱 이모지 쓰기는 본문을 파싱하기 전에 403을 반환한다", async () => {
  user = SIGNED_IN;
  try {
    const at = await fresh();
    const logout = await at("/auth/logout", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": TOKEN }, body: "{" });
    assert.notEqual(logout.status, 400);
    const emoji = await at("/api/app-emojis/x", { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": TOKEN }, body: "{" });
    assert.equal(emoji.status, 403);
  } finally {
    user = null;
  }
});

test("대문자 /API도 화면 폴백이 답하지 않고 API로 가서 센다", () =>
  withLimits({ apiMax: 1 }, async () => {
    const at = await fresh();
    const first = await at("/API/admin/status");
    assert.equal(first.status, 401, "HTML이 아니라 운영자 인증 검사");
    assert.equal((await at("/API/admin/status")).status, 429);
  }));

test("Content-Length가 상한을 넘으면 받지 않고 곧바로 413으로 닫고, 길이를 알리지 않은 본문이 상한을 넘으면 연결을 끊는다", async () => {
  const server = await listenForFetch(appOf(), "127.0.0.1");
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  user = SIGNED_IN;
  try {
    const declared = await raw(port, `POST /api/guilds/1/player/queue HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2000000\r\nx-csrf-token: ${TOKEN}\r\n\r\n`, "{");
    assert.match(declared.got, /^HTTP\/1\.1 413/);
    assert.equal(declared.closed, true);

    const chunk = "x".repeat(40_000);
    const chunked = await raw(port, `POST /api/guilds/1/player/queue HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nx-csrf-token: ${TOKEN}\r\n\r\n`, `${chunk.length.toString(16)}\r\n${chunk}\r\n`);
    assert.equal(chunked.closed, true, "상한을 넘은 청크 본문은 남은 것을 기다리지 않고 끊는다");
  } finally {
    user = null;
  }
});

test("남은 본문이 작아도 요청 제한에 걸렸거나 본문을 받을 일이 없는 메서드면 받아 버리지 않고 닫는다. OPTIONS도 센다", () =>
  withLimits({ apiMax: 1, publicMax: 1 }, async () => {
    const server = await listenForFetch(appOf(), "127.0.0.1");
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const small = JSON.stringify({ x: "y".repeat(20_000) });
    const head = `PUT /api/admin/ai/settings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${small.length}\r\n\r\n`;
    const first = await raw(port, head, small, { waitMs: 500 });
    assert.match(first.got, /^HTTP\/1\.1 403/);
    assert.equal(first.closed, false);
    const limited = await raw(port, head, small.slice(0, 100));
    assert.match(limited.got, /^HTTP\/1\.1 429/);
    assert.equal(limited.closed, true, "걸린 요청의 남은 본문은 받지 않는다");

    const getWithBody = await raw(port, "GET /login-background HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n", "x");
    assert.equal(getWithBody.closed, true, "GET의 남은 본문은 받지 않는다");

    const options = () => raw(port, "OPTIONS /api/me HTTP/1.1\r\nHost: x\r\n\r\n", "", { waitMs: 300 }).then((r) => r.got.slice(0, 12));
    const statuses = [await options(), await options()];
    assert.ok(statuses.includes("HTTP/1.1 429"), `OPTIONS도 공개 한도에 센다: ${statuses.join(", ")}`);
  }));

test("JSON이 아닌 업로드(이미지)는 JSON 상한을 적용받지 않는다(각 경로가 자체 상한으로 읽는다)", async () => {
  const server = await listenForFetch(appOf(), "127.0.0.1");
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  user = { id: "owner", username: "owner" };
  try {
    const image = "x".repeat(40_000);
    const declared = await raw(port, `POST /api/app-emojis HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: ${image.length}\r\nx-csrf-token: ${TOKEN}\r\n\r\n`, image);
    assert.match(declared.got, /^HTTP\/1\.1 \d{3}/);
    assert.doesNotMatch(declared.got, /^HTTP\/1\.1 413/);
    const chunked = await raw(port, `POST /api/app-emojis HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nTransfer-Encoding: chunked\r\nx-csrf-token: ${TOKEN}\r\n\r\n`, `${image.length.toString(16)}\r\n${image}\r\n0\r\n\r\n`);
    assert.match(chunked.got, /^HTTP\/1\.1 \d{3}/, "끊지 않고 답한다");
    assert.doesNotMatch(chunked.got, /^HTTP\/1\.1 413/);
  } finally {
    user = null;
  }
});

test("요청 제한에 걸린 요청은 그 요청에서만 세션을 떼어 응답 끝에 갱신, 저장하지 않는다", () => {
  const session = { user: SIGNED_IN };
  const req = fake<Request>({ session, rateLimit: { resetTime: new Date(Date.now() + 5000) } });
  const sent: unknown[] = [];
  const res = fake<Response>({
    set: () => res,
    status: () => ({ type: () => ({ json: (b: unknown) => sent.push(b) }) }),
  });
  tooManyRequests(req, res);
  assert.equal(req.session, null);
  assert.equal(session.user, SIGNED_IN, "세션 자체는 그대로다");
});
