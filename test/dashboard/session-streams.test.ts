// src/dashboard/session-streams.ts: 스트림(SSE)을 연 로그인 세션에 묶고 세션이 끝나면 끊는다.
// 훔친 쿠키를 쥔 쪽의 자리에서 본다: 열어 둔 스트림, 읽지 않는 연결, 세션을 바꾼 채 연 스트림. 진짜 express-session, 저장소, 소켓으로

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import type { Socket } from "node:net";
import express, { type Response } from "express";
import session from "express-session";
import type { Server } from "node:http";
import { SqliteSessionStore, SESSION_MAX_MS } from "../../src/dashboard/session-store.ts";
import { noteDevice, openRecord } from "../../src/dashboard/login-devices.ts";
import * as sessionStreams from "../../src/dashboard/session-streams.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";
import * as listen from "../helpers/listen.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-session-streams-"));
let store: SqliteSessionStore;
let server: Server;
let base: string;
// 서버가 연 스트림의 응답과 그 소켓, 모듈 정리를 부른 수
const opened: Array<{ res: Response; socket: Socket }> = [];
let dropped = 0;

before(async () => {
  secrets._useKey(newSecretsKey());
  store = new SqliteSessionStore({ dbPath: path.join(dir, "sessions.db") });
  const app = express();
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, store, cookie: { maxAge: 7 * 24 * 60 * 60_000 } }));
  app.use(noteDevice);
  // 로그인(시험): 사용자와 로그인 시각을 세션에 둔다
  app.post("/login", (req, res) => {
    req.session.user = { id: String(req.query.u), username: String(req.query.u), globalName: String(req.query.u), avatar: null };
    req.session.loginAt = Number(req.query.at ?? Date.now());
    req.session.save(() => res.status(204).end());
  });
  app.post("/logout", (req, res) => req.session.destroy(() => res.status(204).end()));
  // 대시보드 스트림 경로의 모양: 로그인, 열기 바로 앞의 확인, 머리, 묶기
  app.get("/stream", (req, res) => {
    // revoke: 세션을 읽은 뒤 열기 앞에서 끝낸다(기다리는 사이 다른 기기에서 끊은 것)
    if (req.query.revoke) store.destroy(req.sessionID);
    // other: 기다리는 사이 같은 세션의 다른 요청이 저장했다(CSRF 토큰을 처음 받음)
    if (req.query.other) {
      const row = store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(req.sessionID) as string;
      store.db.prepare("UPDATE sessions SET data = ? WHERE sid = ?").run(JSON.stringify({ ...JSON.parse(row), csrfToken: "다른 요청의 것" }), req.sessionID);
    }
    if (!req.session?.user || !sessionStreams.admit(req)) return res.status(401).end();
    // plain: Connection: close 없이(소켓 부수기만 시험한다. 그 머리가 있으면 이 PC 에서는 끝내기만으로도 닫힌다)
    res.writeHead(200, req.query.plain ? { "Content-Type": "text/event-stream" } : { "Content-Type": "text/event-stream", Connection: "close" });
    res.flushHeaders();
    res.write(": open\n\n");
    opened.push({ res, socket: req.socket });
    sessionStreams.track(req, res, "시험 스트림", () => dropped++);
  });
  server = await listen.listenForFetch(app);
  // 끝낸 연결이 keep-alive 시간으로 닫히지 않게(소켓 부수기가 빠지면 기다리다 실패한다)
  server.keepAliveTimeout = 60_000;
  base = listen.baseUrl(server);
});
after(() => {
  sessionStreams._reset();
  server.closeAllConnections();
  server.close();
  store.close();
  secrets._useKey();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});
afterEach(() => {
  sessionStreams._reset();
  opened.length = 0;
  dropped = 0;
});

// 쿠키 하나 = 기기 하나
function device(ua = UA) {
  let cookie = "";
  const go = async (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie, "user-agent": ua, ...init.headers } });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  };
  const sid = () =>
    decodeURIComponent(cookie.split("=")[1] ?? "")
      .replace(/^s:/, "")
      .split(".")[0];
  return { go, sid, cookie: () => cookie };
}

// 스트림을 열고 받은 글을 모은다. ended: 서버가 끝냈을 때
async function openStream(who: ReturnType<typeof device>, headers: Record<string, string> = {}, query = "") {
  const controller = new AbortController();
  const res = await who.go(`/stream${query}`, { signal: controller.signal, headers });
  let text = "";
  let resolveEnd: () => void = () => {};
  const ended = new Promise<void>((done) => (resolveEnd = done));
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      } catch {
        // 끊겼다
      }
      resolveEnd();
    })();
  }
  return { status: res.status, text: () => text, ended, abort: () => controller.abort() };
}

const rowOf = (sid: string) => store.db.prepare("SELECT sid FROM sessions WHERE sid = ?").get(sid);
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));
// 고침이 빠지면 멈추지 말고 실패하게
const within = <T>(promise: Promise<T>, ms = 3000) => Promise.race([promise, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`${ms}ms 안에 끝나지 않음`)), ms))]);

test("로그아웃하면 그 세션의 스트림은 끝 이벤트를 받고 닫힌다. 다시 열면 401", async () => {
  const thief = device();
  await thief.go("/login?u=s1", { method: "POST" });
  const stream = await openStream(thief);
  assert.equal(stream.status, 200);
  await thief.go("/logout", { method: "POST" });
  await within(stream.ended);
  assert.match(stream.text(), /event: session-ended/);
  assert.equal(dropped, 1, "모듈 정리를 곧바로 부른다");
  assert.equal((await thief.go("/stream")).status, 401);
});

test("다른 기기에서 끊은 것(저장소의 지우기)도 곧바로 끊는다", async () => {
  const thief = device();
  await thief.go("/login?u=s2", { method: "POST" });
  const stream = await openStream(thief);
  store.destroy(thief.sid());
  await within(stream.ended);
  assert.match(stream.text(), /event: session-ended/);
});

test("알림 없는 끝(날 SQL 로 지움)은 다시 보기가 끊는다. 세션을 바꾼 채 연 스트림이어도 끊은 뒤 행이 다시 생기지 않는다(요청에서 세션을 뗐다)", async () => {
  const thief = device();
  await thief.go("/login?u=s3", { method: "POST" });
  // User-Agent 를 바꾸면 기기 기록이 바뀌어 그 요청이 끝날 때 express-session 이 세션을 저장하려 한다
  const stream = await openStream(thief, { "user-agent": `${UA} Changed` });
  const sid = thief.sid();
  store.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
  sessionStreams.recheck();
  await within(stream.ended);
  await settle(50);
  assert.equal(rowOf(sid), undefined, "되살아나지 않는다");
});

test("열기 바로 앞에서 본다: 세션을 읽은 뒤 끝난 세션은 열지 않고 한 바이트도 보내지 않는다", async () => {
  const thief = device();
  await thief.go("/login?u=s4", { method: "POST" });
  const res = await thief.go("/stream?revoke=1");
  assert.equal(res.status, 401);
  assert.equal(opened.length, 0);
});

test("기기 기록은 지금 행에 그것만 쓴다(기다리는 사이 다른 요청이 저장한 것을 옛 사본으로 덮지 않는다)", async () => {
  const thief = device();
  await thief.go("/login?u=s10", { method: "POST" });
  const stream = await openStream(thief, { "user-agent": `${UA} Changed` }, "?other=1");
  const data = JSON.parse(store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(thief.sid()) as string) as { device?: string; csrfToken?: string };
  assert.equal(data.csrfToken, "다른 요청의 것");
  assert.match(openRecord(thief.sid(), data.device)?.ua ?? "", /Changed/);
  stream.abort();
});

test("스트림을 연 요청의 기기 기록(브라우저, 주소)은 세션을 떼기 전에 저장한다", async () => {
  const thief = device();
  await thief.go("/login?u=s9", { method: "POST" });
  const stream = await openStream(thief, { "user-agent": `${UA} Changed` });
  const data = JSON.parse(store.db.prepare("SELECT data FROM sessions WHERE sid = ?").pluck().get(thief.sid()) as string) as { device?: string };
  assert.match(openRecord(thief.sid(), data.device)?.ua ?? "", /Changed/);
  stream.abort();
});

// 날 TCP 로 스트림을 열고 읽지 않는다(HTTP 클라이언트의 pause 는 소켓 읽기까지 멈추지 않는다). 서버 쪽 응답과 소켓
async function openUnread(who: ReturnType<typeof device>, query = "") {
  const url = new URL(base + "/stream");
  const raw = net.connect(Number(url.port), url.hostname);
  raw.on("error", () => {});
  await new Promise((done) => raw.once("connect", done));
  raw.write(`GET /stream${query} HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${who.cookie()}\r\nUser-Agent: ${UA}\r\n\r\n`);
  raw.pause();
  while (!opened.length) await settle(10);
  return { raw, ...opened[0] };
}

// 소켓이 부서질 때까지 기다린 시간(ms). limit 까지 안 부서지면 null
async function untilDestroyed(socket: Socket, limit = 4000) {
  const started = Date.now();
  while (!socket.destroyed && Date.now() - started < limit) await settle(20);
  return socket.destroyed ? Date.now() - started : null;
}

test("읽지 않는 연결도 서버 쪽 소켓이 부서진다(끝내기로는 남는다)", async () => {
  const thief = device();
  await thief.go("/login?u=s5", { method: "POST" });
  const { raw, res, socket } = await openUnread(thief);
  // 클라이언트가 읽지 않는 동안 쌓인다. 운영체제의 소켓 버퍼(로컬은 수 MB)를 넘겨야 막힌다
  const chunk = "x".repeat(1024 * 1024);
  for (let i = 0; i < 64; i++) res.write(`data: ${chunk}\n\n`);
  assert.ok(res.writableLength > 1024 * 1024, `막혔다 ${res.writableLength}`);
  store.destroy(thief.sid());
  const took = await untilDestroyed(socket);
  assert.notEqual(took, null, "부서진다");
  assert.ok(took! < 2000, `keep-alive 를 기다리지 않는다(${took}ms)`);
  raw.destroy();
});

// Connection: close 없이 열면 소켓 부수기가 빠졌을 때 연결이 keep-alive 로 남는다(위 시험은 이 PC 에서 그 머리만으로도 닫혀 부수기를 가르지 못한다)
test("Connection: close 없이 연 스트림도: 쌓인 것이 많으면 곧바로 부순다", async () => {
  const thief = device();
  await thief.go("/login?u=s5b", { method: "POST" });
  const { raw, res, socket } = await openUnread(thief, "?plain=1");
  const chunk = "x".repeat(1024 * 1024);
  for (let i = 0; i < 64; i++) res.write(`data: ${chunk}\n\n`);
  assert.ok(res.writableLength > 1024 * 1024, `막혔다 ${res.writableLength}`);
  store.destroy(thief.sid());
  const took = await untilDestroyed(socket);
  assert.notEqual(took, null, "부서진다");
  assert.ok(took! < 500, `곧바로(${took}ms)`);
  raw.destroy();
});

test("Connection: close 없이 연 스트림도: 쌓인 것이 적으면 끝 이벤트를 쓰고 1초 뒤에 부순다", async () => {
  const thief = device();
  await thief.go("/login?u=s5c", { method: "POST" });
  const { raw, res, socket } = await openUnread(thief, "?plain=1");
  assert.ok(res.writableLength < 512 * 1024);
  store.destroy(thief.sid());
  const took = await untilDestroyed(socket);
  assert.notEqual(took, null, "부서진다(keep-alive 로 남지 않는다)");
  assert.ok(took! >= 900 && took! < 2500, `끝 이벤트를 받을 틈을 두고(${took}ms)`);
  raw.destroy();
});

test("저장소를 읽다 실패하면 한두 번은 두고, 세 번 잇달아면 끊는다", async () => {
  const thief = device();
  await thief.go("/login?u=s6", { method: "POST" });
  const stream = await openStream(thief);
  const real = store.liveSession;
  store.liveSession = () => {
    throw new Error("database is locked");
  };
  try {
    sessionStreams.recheck();
    sessionStreams.recheck();
    await settle(30);
    assert.doesNotMatch(stream.text(), /session-ended/, "두 번은 둔다");
    sessionStreams.recheck();
    await within(stream.ended);
    assert.match(stream.text(), /session-ended/);
  } finally {
    store.liveSession = real;
  }
});

test("로그인 30일이 지나면 저장소가 망가져 있어도 끊는다(쥐고 있는 로그인 시각으로)", async () => {
  const thief = device();
  await thief.go(`/login?u=s7&at=${Date.now() - SESSION_MAX_MS + 60_000}`, { method: "POST" });
  const stream = await openStream(thief);
  const real = store.liveSession;
  store.liveSession = () => {
    throw new Error("database is locked");
  };
  try {
    sessionStreams.recheck(Date.now() + 120_000);
    await within(stream.ended);
    assert.match(stream.text(), /session-ended/);
  } finally {
    store.liveSession = real;
  }
});

test("클라이언트가 끊으면 묶음에서 빠진다(다시 보기가 끝난 스트림을 읽지 않는다)", async () => {
  const thief = device();
  await thief.go("/login?u=s8", { method: "POST" });
  const stream = await openStream(thief);
  let reads = 0;
  const real = store.liveSession.bind(store);
  store.liveSession = (sid: string) => (reads++, real(sid));
  try {
    stream.abort();
    await within(stream.ended);
    await settle(50);
    sessionStreams.recheck();
    assert.equal(reads, 0);
  } finally {
    store.liveSession = real;
  }
});
