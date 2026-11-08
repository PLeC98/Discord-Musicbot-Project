// src/dashboard/session-requests.ts: 세션이 끝나면 그 세션으로 진행 중인 요청(스트림 외)을 멈춘다.
// 훔친 쿠키를 가진 쪽의 입장에서 본다: 대기 중인 읽기와 조작, 스트리밍 다운로드, 한 번에 쓰고 끝낸 큰 응답, 받는 중인 업로드를 확인한다.
// 실제 express-session, 저장소, 소켓으로 테스트한다. 세션을 끊는 방식은 다른 기기 로그아웃(저장소에서 삭제)과 원시 SQL 직접 삭제(알림 없는 종료)다

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import type { Socket } from "node:net";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import { noteDevice } from "../../src/dashboard/login-devices.ts";
import * as sessionRequests from "../../src/dashboard/session-requests.ts";
import { requireAuth } from "../../src/dashboard/middleware/require-auth.ts";
import { errorHandler } from "../../src/dashboard/middleware/error-handler.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";
import * as listen from "../helpers/listen.ts";
import { cookieJar } from "../helpers/cookie-jar.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-session-inflight-"));
let store: SqliteSessionStore;
let server: Server;
let base: string;
const file = path.join(dir, "big.bin");

// 열어 줄 때까지 대기하는 게이트다. 핸들러가 진입하면 entered가 풀린다
let gate: { entered: Promise<void>; enter: () => void; open: () => void; opened: Promise<void> };
function newGate() {
  let enter: () => void = () => {};
  let open: () => void = () => {};
  const entered = new Promise<void>((done) => (enter = done));
  const opened = new Promise<void>((done) => (open = done));
  gate = { entered, enter, open, opened };
}
// 조작이 실제로 실행된 횟수와 서버 쪽 소켓이다
let effects = 0;
let lastSocket: Socket | null = null;
let lastRes: express.Response | null = null;

before(async () => {
  secrets._useKey(newSecretsKey());
  store = new SqliteSessionStore({ dbPath: path.join(dir, "sessions.db") });
  fs.writeFileSync(file, Buffer.alloc(16 * 1024 * 1024, 1));
  const app = express();
  app.use(sessionRequests.noteSocket);
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, store, cookie: { maxAge: 7 * 24 * 60 * 60_000 } }));
  app.use(noteDevice);
  app.use(sessionRequests.bind);
  app.post("/login", (req, res) => {
    req.session.user = { id: String(req.query.u), username: String(req.query.u), globalName: String(req.query.u), avatar: null };
    req.session.loginAt = Date.now();
    req.session.save(() => res.status(204).end());
  });
  // 대기 중인 읽기: 풀리면 응답한다(json, redirect, file, 또는 HEAD)
  app.all("/hold-read", requireAuth, async (req, res) => {
    lastSocket = req.socket;
    gate.enter();
    await gate.opened;
    if (req.query.as === "redirect") return res.redirect("/somewhere");
    if (req.query.as === "file") return res.sendFile(file);
    res.json({ secret: "끊긴 뒤에 나가면 안 되는 것" });
  });
  // 대기 중인 조작: 풀리면 변경 직전에 세션을 확인한다. 경로의 catch를 거친다(그 catch가 예외를 삼키지 않는다)
  app.post("/hold-change", requireAuth, async (req, res) => {
    gate.enter();
    await gate.opened;
    try {
      sessionRequests.assertSignedIn(req);
      effects++;
      res.json({ ok: true });
    } catch (error) {
      if (sessionRequests.sessionEnded(res, error)) return;
      res.status(500).json({ code: "change-failed" });
    }
  });
  // 대기 중인 조작이 풀린 뒤 봇 버그 예외를 던진다
  app.post("/hold-throw", requireAuth, async () => {
    gate.enter();
    await gate.opened;
    throw new Error("봇 버그");
  });
  // 스트리밍 다운로드다(끊길 때까지 데이터를 계속 보낸다)
  app.get("/download", requireAuth, (req, res) => {
    lastSocket = req.socket;
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024)), 5);
    res.on("close", () => clearInterval(timer));
    gate.enter();
  });
  // 한 번에 쓰고 끝낸 큰 응답이다(로그 파일 다운로드 형태)
  app.get("/bulk", requireAuth, (req, res) => {
    lastSocket = req.socket;
    lastRes = res;
    res.type("text/plain");
    for (let i = 0; i < 64; i++) res.write("x".repeat(256 * 1024));
    res.end();
    gate.enter();
  });
  // 받는 중인 업로드: 본문을 다 받으면 조작한다
  app.post("/upload", requireAuth, (req, res) => {
    lastSocket = req.socket;
    gate.enter();
    req.on("data", () => {});
    req.on("end", () => {
      effects++;
      res.json({ ok: true });
    });
  });
  // 로그인하지 않은 요청이 세션을 바꾼다(저장되면 안 된다)
  app.get("/anon", (req, res) => {
    (req.session as unknown as { visited: boolean }).visited = true;
    res.json({ ok: true });
  });
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  server = await listen.listenForFetch(app);
  server.keepAliveTimeout = 60_000;
  base = listen.baseUrl(server);
});
after(() => {
  sessionRequests._reset();
  server.closeAllConnections();
  server.close();
  store.close();
  secrets._useKey();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});
afterEach(() => {
  gate?.open();
  sessionRequests._reset();
  effects = 0;
  lastSocket = null;
});

// 쿠키 하나 = 기기 하나
function device(ua = UA) {
  const jar = cookieJar();
  const go = async (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie: jar.header(), "user-agent": ua, ...init.headers } });
    jar.take(res);
    return res;
  };
  const sid = () =>
    decodeURIComponent(jar.get("connect.sid") ?? "")
      .replace(/^s:/, "")
      .split(".")[0];
  return { go, sid, cookie: () => jar.header(), jar };
}

async function signedIn(name: string) {
  const who = device();
  await who.go(`/login?u=${name}`, { method: "POST" });
  return who;
}

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function untilDestroyed(socket: Socket, limit = 3000) {
  const started = Date.now();
  while (!socket.destroyed && Date.now() - started < limit) await settle(20);
  return socket.destroyed;
}
// 다른 기기에서 끊었다
const revoke = (who: ReturnType<typeof device>) => store.destroy(who.sid());

for (const as of ["json", "redirect", "head"] as const) {
  test(`대기 중인 읽기(${as})가 세션이 끝난 뒤 응답하면 그 응답 대신 401이고 쿠키를 싣지 않는다`, async () => {
    newGate();
    const thief = await signedIn(`read-${as}`);
    const pending = thief.go(`/hold-read?as=${as}`, { method: as === "head" ? "HEAD" : "GET" });
    await gate.entered;
    revoke(thief);
    gate.open();
    const res = await pending;
    assert.equal(res.status, 401);
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.equal(res.headers.get("location"), null);
    assert.equal(res.headers.get("cache-control"), "no-store");
    if (as !== "head") assert.equal(((await res.json()) as { code: string }).code, "login-required");
  });
}

test("대기 중인 읽기가 파일을 보내려 하면(sendFile) 보내지 않고 소켓을 강제로 닫는다", async () => {
  newGate();
  const thief = await signedIn("read-file");
  const pending = thief.go("/hold-read?as=file").then(
    async (res) => ({ status: res.status, bytes: (await res.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength }),
    () => ({ status: 0, bytes: 0 }),
  );
  await gate.entered;
  revoke(thief);
  gate.open();
  const got = await pending;
  assert.ok(got.status === 0 || got.bytes < 16 * 1024 * 1024, `파일이 다 나가지 않는다(${got.status}, ${got.bytes})`);
  assert.equal(await untilDestroyed(lastSocket!), true);
});

test("대기 중인 조작은 세션이 끝난 뒤 상태를 바꾸지 않고 401을 반환한다(경로의 catch가 삼키지 않는다)", async () => {
  newGate();
  const thief = await signedIn("change");
  const pending = thief.go("/hold-change", { method: "POST" });
  await gate.entered;
  revoke(thief);
  gate.open();
  const res = await pending;
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as { code: string }).code, "login-required");
  assert.equal(effects, 0);
  assert.deepEqual(res.headers.getSetCookie(), []);
});

test("세션이 끝난 요청에서 발생한 봇 버그는 세션 종료로 가리지 않는다(오류 핸들러가 그대로 500을 반환한다)", async () => {
  newGate();
  const thief = await signedIn("throw");
  const pending = thief.go("/hold-throw", { method: "POST" });
  await gate.entered;
  revoke(thief);
  gate.open();
  assert.equal((await pending).status, 500);
});

test("세션이 끊기기 전에 완료한 조작은 그대로 응답한다", async () => {
  newGate();
  const owner = await signedIn("change-ok");
  const pending = owner.go("/hold-change", { method: "POST" });
  await gate.entered;
  gate.open();
  assert.equal((await pending).status, 200);
  assert.equal(effects, 1);
});

test("스트리밍 다운로드는 세션이 끝나면 소켓을 강제로 닫는다", async () => {
  newGate();
  const thief = await signedIn("download");
  const res = await thief.go("/download");
  assert.equal(res.status, 200);
  await gate.entered;
  revoke(thief);
  assert.equal(await untilDestroyed(lastSocket!), true);
  await res.body?.cancel().catch(() => {});
});

test("한 번에 쓰고 끝낸 큰 응답이 읽지 않는 클라이언트의 소켓에 남아 있어도 소켓을 강제로 닫는다. 같은 연결의 다음 요청(다른 사용자)은 그대로 둔다", async () => {
  newGate();
  const thief = await signedIn("bulk");
  const url = new URL(base);
  const raw = net.connect(Number(url.port), url.hostname);
  raw.on("error", () => {});
  await new Promise((done) => raw.once("connect", done));
  raw.write(`GET /bulk HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${thief.cookie()}\r\nUser-Agent: ${UA}\r\n\r\n`);
  raw.pause();
  await gate.entered;
  await settle(50);
  const socket = lastSocket!;
  assert.equal(socket.destroyed, false);
  // 이 PC(Windows 루프백)에서는 커널이 다 받아 응답이 끝나고 닫혀(writableFinished) sweepSockets가 소켓을 닫는다. 끝냈지만 다 나가지 않은 응답(writableEnded이고
  // writableFinished 아님)은 여기서 만들 수 없어, 그때 소켓을 닫는 분기(stop)는 이 테스트가 검증하지 못한다
  assert.equal(lastRes!.writableEnded, true);
  revoke(thief);
  assert.equal(await untilDestroyed(socket), true, "응답은 끝났지만 바이트가 남은 소켓");
  raw.destroy();

  // keep-alive로 이어 쓴 연결: 끊긴 세션의 요청 뒤에 다른 사용자의 요청이 같은 소켓으로 왔으면 닫지 않는다
  newGate();
  const victim = await signedIn("bulk-victim");
  const other = await signedIn("bulk-other");
  const agent = net.connect(Number(url.port), url.hostname);
  agent.on("error", () => {});
  await new Promise((done) => agent.once("connect", done));
  let received = "";
  agent.on("data", (chunk) => (received += chunk.toString("latin1")));
  agent.write(`GET /ping HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${victim.cookie()}\r\nUser-Agent: ${UA}\r\n\r\n`);
  while (!/\r\n\r\n\{"ok":true\}/.test(received)) await settle(10);
  agent.write(`GET /hold-read HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${other.cookie()}\r\nUser-Agent: ${UA}\r\n\r\n`);
  await gate.entered;
  const shared = lastSocket!;
  revoke(victim);
  await settle(100);
  assert.equal(shared.destroyed, false, "다른 사용자의 요청이 쓰는 연결");
  gate.open();
  while (!/secret/.test(received)) await settle(10);
  agent.destroy();
});

test("받는 중인 업로드는 세션이 끝나면 소켓을 강제로 닫고 조작을 실행하지 않는다", async () => {
  newGate();
  const thief = await signedIn("upload");
  const url = new URL(base);
  const raw = net.connect(Number(url.port), url.hostname);
  raw.on("error", () => {});
  await new Promise((done) => raw.once("connect", done));
  raw.write(`POST /upload HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${thief.cookie()}\r\nUser-Agent: ${UA}\r\nContent-Length: ${10 * 1024 * 1024}\r\n\r\n`);
  raw.write(Buffer.alloc(64 * 1024));
  await gate.entered;
  revoke(thief);
  assert.equal(await untilDestroyed(lastSocket!), true);
  assert.equal(effects, 0);
  raw.destroy();
});

test("알림 없는 세션 종료(원시 SQL로 삭제)를 재확인(recheck)에서 감지하면, 세션을 바꾼 채 대기하던 요청이 끝나도 행이 다시 생기지 않는다", async () => {
  newGate();
  const thief = await signedIn("raw-sql");
  const pending = thief.go("/hold-change", { method: "POST", headers: { "user-agent": `${UA} Changed` } });
  await gate.entered;
  store.db.prepare("DELETE FROM sessions WHERE sid = ?").run(thief.sid());
  sessionRequests.recheck();
  gate.open();
  assert.equal((await pending).status, 401);
  assert.equal(store.db.prepare("SELECT sid FROM sessions WHERE sid = ?").get(thief.sid()), undefined);
});

test("로그인하지 않은 세션은 바꿔도 저장하지 않고 쿠키도 싣지 않는다", async () => {
  const visitor = device();
  const before = store.db.prepare("SELECT COUNT(*) FROM sessions").pluck().get() as number;
  const res = await visitor.go("/anon");
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers.getSetCookie(), []);
  assert.equal(store.db.prepare("SELECT COUNT(*) FROM sessions").pluck().get(), before);
});
