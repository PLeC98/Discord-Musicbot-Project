// src/dashboard/rate-limits.ts — 요청 제한. 일반 API 한도에서 빼는 경로와, 로그인한 사람마다 세는지

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { limiter, unlimited } from "../../src/dashboard/rate-limits.ts";
import { signedInAs } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";

test("실시간 연결 · 음량만 일반 API 한도에서 뺀다", () => {
  const of = (url: string) => unlimited({ originalUrl: url });
  for (const url of ["/api/admin/logs/stream", "/api/guilds/events", "/api/guilds/123/player/events", "/api/guilds/123/player/volume", "/api/guilds/123/player/volume?queue=0"]) assert.equal(of(url), true, url);
  for (const url of ["/api/guilds/123/player/skip", "/api/guilds/123/player", "/api/me", "/api/admin/logs", "/api/guilds/123/player/volume/x"]) assert.equal(of(url), false, url);
});

test("로그인한 사람마다 세고, 넘으면 문제 응답 429", async () => {
  let who = "u1";
  const app = express();
  app.use(signedInAs(() => ({ id: who })));
  app.use(limiter(2));
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
