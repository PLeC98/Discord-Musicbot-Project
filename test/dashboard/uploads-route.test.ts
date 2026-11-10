// src/dashboard/routes/uploads.ts, body-limit.ts, rate-limits.ts: 청크 업로드가 앱 전체(요청 제한, CSRF, 운영자, 본문 읽기)를 지나 동작하고,
// 청크를 읽기 전에 거절해도 로그인한 요청이면 그 이유가 연결 리셋 없이 닿는다

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
const store = openTempStore("uploads-route-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const uploads = await import("../../src/dashboard/uploads.ts");

const TOKEN = "t".repeat(43);
let user: { id: string; username: string } | null = { id: "owner", username: "owner" };
const fakeSession = (req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({ user: user ?? undefined, loginAt: Date.now(), csrfToken: TOKEN, destroy: (done: () => void) => done() });
  next();
};
const server: Server = await listenForFetch(createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: fakeSession }), "127.0.0.1");
const port = (server.address() as AddressInfo).port;
const origin = baseUrl(server);
after(() => {
  uploads._reset();
  server.close();
  store.close();
});

const json = (method: string, path: string, body?: object) => fetch(origin + path, { method, headers: { "content-type": "application/json", "x-csrf-token": TOKEN }, body: body ? JSON.stringify(body) : undefined });
const chunk = (id: string, offset: number, bytes: Buffer) => fetch(`${origin}/api/admin/uploads/${id}?offset=${offset}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-csrf-token": TOKEN }, body: bytes });
const codeOf = async (res: globalThis.Response) => [res.status, ((await res.json()) as { code: string }).code];
async function started(size: number) {
  const res = await json("POST", "/api/admin/uploads", { purpose: "archive", size });
  assert.equal(res.status, 200);
  return (await res.json()) as { id: string; chunkSize: number; received: number };
}

test("시작, 청크, 상태, 취소. 청크는 일반 요청 한도에서 빠진다", async () => {
  const saved = config.dashboard.rateLimit.apiMax;
  config.dashboard.rateLimit.apiMax = 3;
  try {
    const { id, chunkSize, received } = await started(10);
    assert.deepEqual([chunkSize, received], [uploads.CHUNK_SIZE, 0]);
    for (let at = 0; at < 10; at += 2) assert.deepEqual(await (await chunk(id, at, Buffer.alloc(2))).json(), { received: at + 2 });
    assert.deepEqual(await (await json("GET", `/api/admin/uploads/${id}`)).json(), { received: 10, size: 10 });
    assert.equal((await json("DELETE", `/api/admin/uploads/${id}`)).status, 204);
  } finally {
    config.dashboard.rateLimit.apiMax = saved;
  }
});

test("청크 검사: 위치가 어긋나면 받은 위치, 선언한 크기를 넘으면 413, 위치가 숫자가 아니면 400, 모르는 업로드는 410", async () => {
  const { id } = await started(4);
  const offset = await chunk(id, 2, Buffer.alloc(2));
  assert.deepEqual(await offset.json().then((body) => [offset.status, (body as { code: string }).code, (body as { received: number }).received]), [409, "upload-offset", 0]);
  assert.deepEqual(await codeOf(await chunk(id, 0, Buffer.alloc(5))), [413, "payload-too-large"]);
  assert.equal((await fetch(`${origin}/api/admin/uploads/${id}?offset=`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-csrf-token": TOKEN }, body: Buffer.alloc(1) })).status, 400);
  assert.deepEqual(await codeOf(await chunk("0".repeat(32), 0, Buffer.alloc(1))), [410, "upload-gone"]);
  assert.deepEqual(await codeOf(await json("POST", "/api/admin/uploads", { purpose: "nope", size: 1 })), [400, "bad-request"]);
});

/** 원시 소켓으로 요청 하나를 본문까지 다 보내고, 같은 연결로 GET 을 하나 더 보낸다. 받은 것과 연결이 끊겼는지 */
async function rawTwice(head: string, body: Buffer) {
  const socket = net.connect(port, "127.0.0.1");
  await once(socket, "connect");
  let got = "";
  let error: string | null = null;
  socket.on("data", (d) => (got += d.toString("latin1")));
  socket.on("error", (e: NodeJS.ErrnoException) => (error = e.code ?? e.message));
  socket.write(head);
  for (let at = 0; at < body.length && !socket.destroyed; at += 64 * 1024) if (!socket.write(body.subarray(at, at + 64 * 1024))) await once(socket, "drain").catch(() => undefined);
  if (!socket.destroyed) socket.write("GET /api/bot HTTP/1.1\r\nHost: x\r\n\r\n");
  const deadline = Date.now() + 3000;
  while (!socket.destroyed && (got.match(/HTTP\/1\.1 /g) ?? []).length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  socket.destroy();
  return { statuses: [...got.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1])), error, got };
}
const BODY = Buffer.alloc(1024 * 1024, 1);
const headFor = (id: string, { csrf = true } = {}) => `PUT /api/admin/uploads/${id}?offset=0 HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\n${csrf ? `X-CSRF-Token: ${TOKEN}\r\n` : ""}Content-Length: ${BODY.length}\r\n\r\n`;

test("청크를 읽기 전에 거절해도 로그인한 요청이면 남은 본문을 읽어서 버리고 응답이 닿는다(연결도 이어 쓴다): CSRF, 운영자 아님, 위치 어긋남", async () => {
  const { id } = await started(4 * 1024 * 1024);
  const csrf = await rawTwice(headFor(id, { csrf: false }), BODY);
  assert.deepEqual([csrf.statuses, csrf.error], [[403, 200], null]);
  const before = await rawTwice(`PUT /api/admin/uploads/${id}?offset=5 HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\nX-CSRF-Token: ${TOKEN}\r\nContent-Length: ${BODY.length}\r\n\r\n`, BODY);
  assert.deepEqual([before.statuses, before.error], [[409, 200], null]);
  user = { id: "u1", username: "u1" };
  try {
    const notOwner = await rawTwice(headFor(id), BODY);
    assert.deepEqual([notOwner.statuses, notOwner.error], [[403, 200], null]);
  } finally {
    user = { id: "owner", username: "owner" };
  }
});

test("청크 상한보다 큰 본문은 로그인했어도 읽어 주지 않고 닫는다", async () => {
  const { id } = await started(64 * 1024 * 1024);
  const big = Buffer.alloc(uploads.CHUNK_SIZE + 1);
  const over = await rawTwice(`PUT /api/admin/uploads/${id}?offset=0 HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\nX-CSRF-Token: ${TOKEN}\r\nContent-Length: ${big.length}\r\n\r\n`, big);
  assert.ok(over.statuses.length < 2, `같은 연결로 다음 요청을 받지 않는다: ${over.statuses}`);
  if (over.statuses.length) assert.match(over.got, /connection: close/i);
});

test("로그인하지 않은 청크 요청은 지금처럼 닫는다(남의 본문을 받아 주지 않는다)", async () => {
  const { id } = await started(4 * 1024 * 1024);
  user = null;
  try {
    const anon = await rawTwice(headFor(id), BODY);
    assert.ok(anon.statuses.length < 2, `같은 연결로 다음 요청을 받지 않는다: ${anon.statuses}`);
    if (anon.statuses.length) assert.match(anon.got, /connection: close/i);
  } finally {
    user = { id: "owner", username: "owner" };
  }
});
