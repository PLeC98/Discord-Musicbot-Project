// src/dashboard/problem.ts — 대시보드 HTTP 오류 응답(RFC 9457). 본문의 모양 · 상태 · 값 필드, 요청 제한의 Retry-After, 코드 설명 주소

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { refuseWith, sendProblem, tooManyRequests, problemsRouter } from "../../src/dashboard/problem.ts";
import { problemBody } from "../../src/dashboard/contract/problem.ts";
import { PROBLEMS } from "../../src/rules/problems.ts";
import { baseUrl, listenForFetch } from "../helpers/listen.ts";
import { fake } from "../helpers/fake.ts";
import { rateLimit, type RateLimitInfo } from "express-rate-limit";

test("본문: type 은 /problems/<코드>, code 는 같은 코드, 상태 · 제목은 목록의 것", () => {
  assert.deepEqual(problemBody("queue-full", { max: 100 }), { type: "/problems/queue-full", code: "queue-full", status: 409, title: "Queue is full", max: 100 });
  for (const code of Object.keys(PROBLEMS) as Array<keyof typeof PROBLEMS>) assert.equal(problemBody(code).type, `/problems/${problemBody(code).code}`, code);
});

test("본문: 값은 그 코드가 목록에 적은 것만 싣고, 이번 일의 것(detail · errors · 확장 필드)은 그대로", () => {
  assert.deepEqual(problemBody("no-song-result", { max: 100, skipped: 3 }), { type: "/problems/no-song-result", code: "no-song-result", status: 404, title: "No track found" });
  assert.deepEqual(problemBody("nothing-playable", { skipped: 3, max: 100 }).skipped, 3);
  assert.equal("max" in problemBody("nothing-playable", { skipped: 3, max: 100 }), false);
  const body = problemBody("bad-settings", {}, { errors: [{ pointer: "/djRoleIds", code: "bad-dj-roles" }], errorId: "abcd1234" });
  assert.deepEqual([body.errors, body.errorId], [[{ pointer: "/djRoleIds", code: "bad-dj-roles" }], "abcd1234"]);
});

// 응답을 받아 적는 가짜
function recorder() {
  const seen: { status?: number; type?: string; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) {
      seen.status = code;
      return res;
    },
    type(value: string) {
      seen.type = value;
      return res;
    },
    set(name: string, value: string) {
      seen.headers[name] = value;
      return res;
    },
    json(body: unknown) {
      seen.body = body;
      return res;
    },
  };
  return { res: res as unknown as express.Response, seen };
}

test("응답: 목록의 상태와 application/problem+json. 거절 결과(코드와 값)는 그대로 옮긴다", () => {
  const { res, seen } = recorder();
  sendProblem(res, "bad-query", { max: 500 });
  assert.deepEqual([seen.status, seen.type, (seen.body as { max: number }).max], [400, "application/problem+json", 500]);

  const refused = recorder();
  refuseWith(refused.res, { code: "bad-position", size: 3 });
  assert.deepEqual(refused.seen.body, { type: "/problems/bad-position", code: "bad-position", status: 400, title: "No track at that position", size: 3 });
});

test("요청 제한: 다시 보낼 수 있을 때까지의 초를 Retry-After 에", () => {
  const { res, seen } = recorder();
  tooManyRequests(fake<express.Request & { rateLimit?: RateLimitInfo }>({ rateLimit: { limit: 1, used: 2, remaining: 0, resetTime: new Date(Date.now() + 30_500) } }), res);
  assert.deepEqual([seen.status, (seen.body as { code: string }).code], [429, "too-many-requests"]);
  assert.ok(["30", "31"].includes(seen.headers["Retry-After"]), seen.headers["Retry-After"]);
});

let server: Server | undefined;
after(() => server?.close());

test("코드 설명: GET /problems/<코드> 는 사람이 읽는 설명, 없는 코드는 route-not-found", async () => {
  const app = express();
  app.use(problemsRouter);
  server = await listenForFetch(app);
  const base = baseUrl(server);
  const page = await fetch(`${base}/problems/queue-full`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.match(html, /<h1>queue-full<\/h1>/);
  assert.match(html, /409/);
  assert.match(html, /Queue is full/);
  assert.match(html, /max/);

  const missing = await fetch(`${base}/problems/no-such-code`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type") ?? "", /application\/problem\+json/);
  assert.equal(((await missing.json()) as { code: string }).code, "route-not-found");
});

test("요청 제한: express-rate-limit 의 처리기로 걸면 넘친 요청은 문제 응답과 Retry-After", async () => {
  const app = express();
  app.use(rateLimit({ windowMs: 60_000, limit: 1, standardHeaders: "draft-7", legacyHeaders: false, handler: tooManyRequests }));
  app.get("/x", (_req, res) => res.json({ ok: true }));
  const limited = await listenForFetch(app);
  try {
    const base = baseUrl(limited);
    assert.equal((await fetch(`${base}/x`)).status, 200);
    const over = await fetch(`${base}/x`);
    assert.equal(over.status, 429);
    assert.match(over.headers.get("content-type") ?? "", /application\/problem\+json/);
    assert.ok(Number(over.headers.get("retry-after")) > 0, "Retry-After");
    assert.equal(((await over.json()) as { code: string }).code, "too-many-requests");
  } finally {
    limited.close();
  }
});
