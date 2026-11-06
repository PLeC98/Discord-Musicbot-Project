// src/dashboard/routes/log-files.ts: 다운로드는 받는 쪽의 속도를 따라 흘려 보내고, 끊기면 멈추고 파일을 닫고, 오래 훑는 동안 이벤트 루프를 놓아 준다

import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logfiles-download-"));
const file = path.join(dir, "bot.log");
const T0 = 1_760_000_000_000;
const LINES = 200_000;
const pad = "x".repeat(80);
fs.writeFileSync(file, Array.from({ length: LINES }, (_, i) => JSON.stringify({ time: T0 + i, level: 30, msg: `줄 ${i} ${pad}`, category: "player" }) + "\n").join(""));
process.env.OWNER_ID = "owner";
process.env.LOG_FILE = file;
process.env.LOG_FILE_ENABLED = "true";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import express, { type Response } from "express";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { logFilesRouter } = await import("../../src/dashboard/routes/log-files.ts");

// 이 파일을 연 fd 와 닫은 fd 를 센다(다운로드가 끝나거나 끊기면 닫아야 한다)
const open = new Set<number>();
const realOpen = fs.openSync;
const realClose = fs.closeSync;
fs.openSync = ((p: fs.PathLike, ...rest: never[]) => {
  const fd = (realOpen as (...args: unknown[]) => number)(p, ...rest);
  if (path.resolve(String(p)) === path.resolve(file)) open.add(fd);
  return fd;
}) as typeof fs.openSync;
fs.closeSync = ((fd: number) => {
  open.delete(fd);
  realClose(fd);
}) as typeof fs.closeSync;

let served: Response | null = null;
let turns = 0;
let turnsAtStart = 0;
let turnsAtFinish = 0;
const app = express();
app.use((req, res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt: Date.now() });
  served = res;
  turnsAtStart = turns;
  turnsAtFinish = 0;
  res.once("finish", () => (turnsAtFinish = turns));
  next();
});
app.use("/api/admin/logs", logFilesRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/logs`;
after(() => {
  fs.openSync = realOpen;
  fs.closeSync = realClose;
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

test("읽지 않는 받는 쪽: 서버는 몇 조각만 쌓고 기다린다, 끊으면 멈추고 파일을 닫는다", async () => {
  const size = fs.statSync(file).size;
  const req = http.get(`${base}/file/download?name=bot.log&tz=0`, { agent: false });
  const [res] = (await new Promise((resolve) => req.once("response", (r) => resolve([r])))) as [http.IncomingMessage];
  res.pause();
  // 커널 버퍼가 찰 때까지 둔다
  await sleep(500);
  const out = served!;
  assert.equal(out.writableEnded, false, "다 쓰지 않고 기다린다");
  assert.ok(out.writableLength < 1024 * 1024, `서버에 쌓인 양 ${out.writableLength} / 파일 ${size}`);
  req.destroy();
  assert.ok(await until(() => open.size === 0), "끊으면 파일을 닫는다");
});

test("읽는 받는 쪽: 걸러 낸 줄을 빠짐없이 순서대로 받고, 파일을 닫는다", async () => {
  const res = await fetch(`${base}/file/download?name=bot.log&tz=0`);
  assert.equal(res.status, 200);
  const lines = (await res.text()).split("\n");
  assert.equal(lines.pop(), "", "마지막 줄도 줄바꿈으로 끝난다");
  assert.equal(lines.length, LINES);
  assert.ok(lines.every((line, i) => line.endsWith(`player 줄 ${i} ${pad}`)));
  assert.ok(await until(() => open.size === 0));
});

test("맞는 줄이 없어도 파일을 훑는 동안 이벤트 루프를 놓아 준다", async () => {
  let running = true;
  const tick = () => {
    turns++;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  try {
    const res = await fetch(`${base}/file/download?name=bot.log&q=${encodeURIComponent("없는 글")}`);
    assert.equal(await res.text(), "");
  } finally {
    running = false;
  }
  assert.ok(await until(() => turnsAtFinish > 0));
  assert.ok(turnsAtFinish - turnsAtStart >= 10, `훑는 동안 돈 차례 ${turnsAtFinish - turnsAtStart}`);
});
