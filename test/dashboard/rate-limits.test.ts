// src/dashboard/rate-limits.ts — 요청 제한. 일반 API 한도에서 빼는 경로와, 로그인한 사람마다 세는지

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { limiter, unlimited } from "../../src/dashboard/rate-limits.ts";
import { tunablesChanged } from "../../src/config/tunables-changed.ts";
import { signedInAs } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";

test("실시간 연결 · 볼륨 · 곡 그림만 일반 API 한도에서 뺀다(그 경로가 따로 센다)", () => {
  const of = (url: string) => unlimited({ originalUrl: url });
  for (const url of ["/api/admin/logs/stream", "/api/guilds/events", "/api/guilds/123/player/events", "/api/guilds/123/player/volume", "/api/guilds/123/player/volume?queue=0", "/api/guilds/123/art/0123456789abcdef0123.jpg"]) assert.equal(of(url), true, url);
  for (const url of ["/api/guilds/123/player/skip", "/api/guilds/123/player", "/api/me", "/api/admin/logs", "/api/guilds/123/player/volume/x", "/api/guilds/123/art/a/b"]) assert.equal(of(url), false, url);
});

test("로그인한 사람마다 세고, 넘으면 문제 응답 429", async () => {
  let who = "u1";
  const app = express();
  app.use(signedInAs(() => ({ id: who })));
  app.use(limiter(() => 2));
  app.get("/x", (_req, res) => res.json({ ok: true }));
  const server = await listenForFetch(app);
  after(() => server.close());
  const get = () => fetch(`${baseUrl(server)}/x`, { signal: AbortSignal.timeout(3000) });

  assert.deepEqual([(await get()).status, (await get()).status], [200, 200]);
  const over = await get();
  assert.equal(over.status, 429);
  assert.equal(((await over.json()) as { code: string }).code, "too-many-requests");
  who = "u2";
  assert.equal((await get()).status, 200, "다른 사람은 따로 센다");
});

// 운영 조절값을 저장하면 바로 먹는다. 한도는 요청마다 읽고, 창 길이가 바뀌면 제한기를 새로 만든다(센 수는 처음부터)
test("한도 · 창 길이를 바꾸면 다시 시작하지 않고 먹는다", async () => {
  let limit = 1;
  let windowMs = 60_000;
  const app = express();
  app.use(signedInAs(() => ({ id: "u1" })));
  app.use(limiter(() => limit, { windowOf: () => windowMs }));
  app.get("/x", (_req, res) => res.json({ ok: true }));
  const server = await listenForFetch(app);
  after(() => server.close());
  const status = async () => (await fetch(`${baseUrl(server)}/x`, { signal: AbortSignal.timeout(3000) })).status;

  assert.deepEqual([await status(), await status()], [200, 429]);
  limit = 3;
  assert.equal(await status(), 200, "한도는 요청마다 읽는다");
  assert.equal(await status(), 429);

  tunablesChanged();
  assert.equal(await status(), 429, "창 길이가 그대로면 센 수도 그대로");
  windowMs = 30_000;
  tunablesChanged();
  assert.equal(await status(), 200, "창 길이가 바뀌면 새로 센다");
});
