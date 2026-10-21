// src/dashboard/routes/log-files.ts — 로그 파일 목록 · 한 쪽 · 내려받기(운영자만, 목록의 이름만, 파일 로그를 끄면 없음)

import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logfiles-route-"));
const file = path.join(dir, "bot.log");
const T0 = 1_760_000_000_000;
fs.writeFileSync(file, Array.from({ length: 20 }, (_, i) => JSON.stringify({ time: T0 + i * 1000, level: i % 2 ? 30 : 50, msg: `줄 ${i}`, category: i % 4 ? "player" : "youtube" }) + "\n").join(""));
process.env.OWNER_ID = "owner";
process.env.LOG_FILE = file;
process.env.LOG_FILE_ENABLED = "true";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { FilePage, LogFileList } from "../../src/dashboard/contract/log-files.ts";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { default: config } = await import("../../src/config/index.ts");
const { logFilesRouter } = await import("../../src/dashboard/routes/log-files.ts");

let user = "owner";
const app = express();
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: user, username: user }, loginAt: Date.now() });
  next();
});
app.use("/api/admin/logs", logFilesRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/logs`;
after(() => server.close());

test("목록과 한 쪽: 운영자는 파일 목록 · 거른 줄을 받는다", async () => {
  const list = (await (await fetch(`${base}/files`)).json()) as LogFileList;
  assert.equal(list.enabled, true);
  assert.deepEqual(
    list.files.map((f) => [f.name, f.lines, f.categories]),
    [["bot.log", 20, ["player", "youtube"]]],
  );
  const page = (await (await fetch(`${base}/file?name=bot.log&levels=error&category=youtube&limit=3`)).json()) as FilePage;
  assert.deepEqual(
    page.lines.map((l) => l.text),
    ["줄 8", "줄 12", "줄 16"],
  );
  assert.equal(page.more, true);
  assert.equal(page.since, T0);
  const found = (await (await fetch(`${base}/file?name=bot.log&q=${encodeURIComponent("줄 1")}`)).json()) as FilePage;
  assert.equal(found.matches, 11, "줄 1 · 10 ~ 19");
});

test("목록에 없는 이름 · 경로는 log-file-not-found", async () => {
  fs.writeFileSync(path.join(dir, "other.txt"), "x");
  for (const name of ["other.txt", "../bot.log", file, ""]) {
    const res = await fetch(`${base}/file?name=${encodeURIComponent(name)}`);
    assert.equal(res.status, 404, name);
    assert.match(((await res.json()) as { type: string }).type, /log-file-not-found/);
  }
  assert.equal((await fetch(`${base}/file/download?name=other.txt`)).status, 404);
});

test("내려받기: 거른 줄을 화면과 같은 칸의 글로, 파일 이름은 .txt", async () => {
  const res = await fetch(`${base}/file/download?name=bot.log&category=youtube&tz=0`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /bot\.txt/);
  const lines = (await res.text()).trim().split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[0], `${new Date(T0).toISOString().replace("T", " ").replace("Z", "")} ERROR youtube 줄 0`);
});

test("운영자가 아니면 막힌다", async () => {
  user = "someone";
  try {
    assert.equal((await fetch(`${base}/files`)).status, 403);
    assert.equal((await fetch(`${base}/file?name=bot.log`)).status, 403);
  } finally {
    user = "owner";
  }
});

test("파일 로그를 끄면 목록이 비고 읽기는 없음", async () => {
  config.logging.fileEnabled = false;
  try {
    assert.deepEqual(await (await fetch(`${base}/files`)).json(), { enabled: false, files: [] });
    assert.equal((await fetch(`${base}/file?name=bot.log`)).status, 404);
  } finally {
    config.logging.fileEnabled = true;
  }
});
