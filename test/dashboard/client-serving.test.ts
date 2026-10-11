// src/dashboard/index.ts — 화면(빌드한 dashboard/dist)을 내주는 법. 빌드가 있는지는 요청 때 본다.
// 봇을 켠 뒤에 화면을 빌드해도 다시 켜지 않고 보인다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { baseUrl } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("client-serving-");
after(() => store.close());

const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");

const dist = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-dist-"));
after(() => fs.rmSync(dist, { recursive: true, force: true, maxRetries: 5 }));

const noSession = (req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({});
  next();
};

let server: Server;
let base: string;
before(async () => {
  const deployCommands = () => assert.fail("이 시험은 명령을 등록하지 않는다");
  server = createApp(fakeBot({ client: { user: null } }), { stream: createPlayerStream(), deployCommands, sessionMiddleware: noSession, clientDist: dist }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = baseUrl(server);
});
after(() => server.close());

const get = async (urlPath: string) => {
  const res = await fetch(base + urlPath, { signal: AbortSignal.timeout(3000) });
  return { status: res.status, body: await res.text() };
};

test("빌드가 없으면 빌드하라고 알리고, 켜 둔 채 빌드하면 다시 켜지 않고 화면을 내준다", async () => {
  const before = await get("/");
  assert.match(before.body, /pnpm run build:dashboard/);

  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>화면</title>");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "assets", "app.js"), "console.log(1)");

  assert.match((await get("/")).body, /<title>화면<\/title>/);
  assert.match((await get("/servers/123")).body, /<title>화면<\/title>/, "화면 안의 주소도 같은 화면");
  assert.equal((await get("/assets/app.js")).body, "console.log(1)");
  assert.equal((await get("/api/없는-경로")).status, 404, "API 는 화면으로 넘기지 않는다");
});

// 이름에 내용 해시가 붙은 빌드 파일은 한 해 동안 묻지 않고 쓰고, 이름이 고정된 화면(index.html)은 매번 묻는다(새 빌드의 새 이름을 받게)
test("빌드 파일(assets/)은 오래 캐시하고 화면 껍데기는 매번 확인한다", async () => {
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>화면</title>");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "assets", "font-abc123.woff2"), "woff2");
  const cacheOf = async (urlPath: string) => (await fetch(base + urlPath, { signal: AbortSignal.timeout(3000) })).headers.get("cache-control");
  assert.equal(await cacheOf("/assets/font-abc123.woff2"), "public, max-age=31536000, immutable");
  assert.equal(await cacheOf("/"), "no-cache");
  assert.equal(await cacheOf("/servers/123"), "no-cache");
});
