// src/dashboard/routes/log-files.ts: 큰 파일에서 목록, 검색, 다운로드가 이벤트 루프를 양보하고, 클라이언트가 연결을 끊으면 멈추고 파일을 닫는다.
// 다운로드는 받는 쪽의 속도에 맞춰 스트리밍한다

import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logfiles-large-"));
const file = path.join(dir, "bot.log");
const T0 = 1_760_000_000_000;
const LINES = 200_000;
const pad = "x".repeat(80);
fs.writeFileSync(file, Array.from({ length: LINES }, (_, i) => JSON.stringify({ time: T0 + i, level: 30, msg: `줄 ${i} ${pad}`, category: "player" }) + "\n").join(""));
const SIZE = fs.statSync(file).size;
process.env.OWNER_ID = "owner";
process.env.LOG_FILE = file;
process.env.LOG_FILE_ENABLED = "true";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import express, { type Response } from "express";
import type { FilePage, LogFileList } from "../../src/dashboard/contract/log-files.ts";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { logFilesRouter } = await import("../../src/dashboard/routes/log-files.ts");

// 이 파일을 연 fd, 연 횟수, 읽은 바이트를 센다(끝나거나 끊기면 닫아야 한다)
const open = new Set<number>();
let opens = 0;
let readBytes = 0;
const realOpen = fs.openSync;
const realClose = fs.closeSync;
const realRead = fs.readSync;
fs.openSync = ((p: fs.PathLike, ...rest: never[]) => {
  const fd = (realOpen as (...args: unknown[]) => number)(p, ...rest);
  if (path.resolve(String(p)) === path.resolve(file)) {
    open.add(fd);
    opens++;
  }
  return fd;
}) as typeof fs.openSync;
fs.closeSync = ((fd: number) => {
  open.delete(fd);
  realClose(fd);
}) as typeof fs.closeSync;
fs.readSync = ((fd: number, ...rest: never[]) => {
  const got = (realRead as (...args: unknown[]) => number)(fd, ...rest);
  if (open.has(fd)) readBytes += got;
  return got;
}) as typeof fs.readSync;

// 요청마다 핸들러가 받은 때부터 응답을 다 쓸 때까지 돈 이벤트 루프 턴 수(setImmediate)
let turns = 0;
let ticking = true;
const tick = () => {
  turns++;
  if (ticking) setImmediate(tick);
};
setImmediate(tick);
const spans: number[] = [];
let served: Response | null = null;
const app = express();
app.use((req, res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt: Date.now() });
  served = res;
  const start = turns;
  res.once("finish", () => spans.push(turns - start));
  next();
});
app.use("/api/admin/logs", logFilesRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/logs`;
after(() => {
  ticking = false;
  fs.openSync = realOpen;
  fs.closeSync = realClose;
  fs.readSync = realRead;
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function until(check: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await sleep(10);
  }
  return true;
}

/** 응답 헤더가 도착하면 그 응답 객체를 돌려준다 */
function getRaw(url: string) {
  const req = http.get(url, { agent: false });
  // 테스트에서 연결을 끊는다
  req.on("error", () => {});
  return { req, response: new Promise<http.IncomingMessage>((resolve) => req.once("response", resolve)) };
}

// 목록을 훑는 작업은 처음 한 번뿐이라 이 테스트가 먼저다
test("목록: 같은 파일을 동시에 불러도 한 번만 훑고, 훑는 동안 이벤트 루프를 양보한다", async () => {
  spans.length = 0;
  const [a, b] = await Promise.all([fetch(`${base}/files`), fetch(`${base}/files`)].map(async (one) => (await (await one).json()) as LogFileList));
  assert.deepEqual([a.files[0].lines, b.files[0].lines], [LINES, LINES]);
  assert.equal(opens, 1, "파일을 한 번만 열었다");
  assert.ok(Math.max(...spans) >= 20, `훑는 동안 돈 턴 수 ${spans.join(", ")}`);
  assert.ok(await until(() => open.size === 0));
});

test("검색 첫 페이지: 일치하는 줄 수를 세는 동안 이벤트 루프를 양보하고, 클라이언트가 연결을 끊으면 멈추고 파일을 닫는다", async () => {
  spans.length = 0;
  const page = (await (await fetch(`${base}/file?name=bot.log&q=${encodeURIComponent("없는 글")}`)).json()) as FilePage;
  assert.deepEqual([page.lines.length, page.matches], [0, 0]);
  assert.ok(spans[0] >= 20, `읽는 동안 돈 턴 수 ${spans[0]}`);
  assert.ok(await until(() => open.size === 0));

  readBytes = 0;
  const { req } = getRaw(`${base}/file?name=bot.log&q=${encodeURIComponent("다른 없는 글")}`);
  assert.ok(await until(() => readBytes > 0), "읽기 시작");
  req.destroy();
  assert.ok(await until(() => open.size === 0), "연결을 끊으면 파일을 닫는다");
  // 끝까지 가면 페이지(뒤에서부터 파일 전체)와 일치하는 줄 수(앞에서부터 파일 전체)로 두 번 읽는다
  assert.ok(readBytes < SIZE / 2, `연결을 끊은 뒤 읽은 양 ${readBytes} / 파일 ${SIZE}`);
});

test("다운로드, 읽지 않는 클라이언트: 서버는 몇 청크만 쌓고 기다리고, 연결을 끊으면 멈추고 파일을 닫는다", async () => {
  const { req, response } = getRaw(`${base}/file/download?name=bot.log&tz=0`);
  (await response).pause();
  // 커널 버퍼가 찰 때까지 둔다
  await sleep(500);
  const out = served!;
  assert.equal(out.writableEnded, false, "다 쓰지 않고 기다린다");
  assert.ok(out.writableLength < 1024 * 1024, `서버에 쌓인 양 ${out.writableLength} / 파일 ${SIZE}`);
  req.destroy();
  assert.ok(await until(() => open.size === 0), "끊으면 파일을 닫는다");
});

test("다운로드, 읽는 클라이언트: 필터링한 줄을 빠짐없이 순서대로 받고, 파일을 닫는다", async () => {
  const res = await fetch(`${base}/file/download?name=bot.log&tz=0`);
  assert.equal(res.status, 200);
  const lines = (await res.text()).split("\n");
  assert.equal(lines.pop(), "", "마지막 줄도 줄바꿈으로 끝난다");
  assert.equal(lines.length, LINES);
  assert.ok(lines.every((line, i) => line.endsWith(`player 줄 ${i} ${pad}`)));
  assert.ok(await until(() => open.size === 0));
});

test("다운로드: 일치하는 줄이 없어도 파일을 훑는 동안 이벤트 루프를 양보한다", async () => {
  spans.length = 0;
  const res = await fetch(`${base}/file/download?name=bot.log&q=${encodeURIComponent("없는 글")}`);
  assert.equal(await res.text(), "");
  assert.ok(await until(() => spans.length > 0));
  assert.ok(spans[0] >= 20, `훑는 동안 돈 턴 수 ${spans[0]}`);
});
