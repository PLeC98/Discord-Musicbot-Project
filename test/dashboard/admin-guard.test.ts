// src/dashboard/routes/admin-mounts.ts, src/dashboard/index.ts: 운영자 패널의 모든 경로(/api/admin 아래)와 밖의 운영자 전용 경로가
// 로그인하지 않으면 401, 운영자가 아니면 403. 라우터를 따로 붙여도(라우터의 검사), 실제 앱으로도(/api/admin 앞의 문) 같다.
// 경로는 라우터의 경로 목록에서 꺼내 새로 더한 경로도 따라온다

process.env.OWNER_ID = "owner";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { signedInAs } from "../helpers/dashboard.ts";
import { baseUrl, listenForFetch } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("admin-guard-");
const { default: config } = await import("../../src/config/index.ts");
const { ADMIN_MOUNTS } = await import("../../src/dashboard/routes/admin-mounts.ts");
const { appEmojisRouter } = await import("../../src/dashboard/routes/app-emojis.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };

/** 라우터의 경로들([메서드, 경로]). 인자와 와일드카드는 x 로, 생략할 수 있는 부분은 뺀다 */
function routesOf(router: Router): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const layer of router.stack as unknown as Layer[]) {
    assert.equal(layer.handle?.stack, undefined, "운영자 라우터 안에 다른 라우터를 붙이지 않는다(붙이면 이 시험이 그 경로를 훑도록 고친다)");
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const p of paths) {
      const concrete = p.replace(/\{[^}]*\}/g, "").replace(/[:*]\w+/g, "x");
      for (const method of Object.keys(layer.route.methods).filter((m) => m !== "_all")) out.push([method.toUpperCase(), concrete]);
    }
  }
  return out;
}

const ADMIN = ADMIN_MOUNTS.flatMap(([at, router]) => routesOf(router).map(([method, p]): [string, string, string, Router] => [method, at, p, router]));
// /api/admin 밖의 운영자 전용(같은 라우터의 나머지는 로그인만)
const OUTSIDE: Array<[string, string]> = [
  ["POST", "/"],
  ["PATCH", "/x"],
  ["DELETE", "/x"],
  ["GET", "/x/uses"],
];

after(() => store.close());

test("운영자 라우터의 경로가 빠짐없이 훑인다(표가 비거나 경로가 사라지지 않았다)", () => {
  assert.ok(ADMIN.length >= 80, `경로 ${ADMIN.length}개`);
  for (const [at, router] of ADMIN_MOUNTS) assert.ok(routesOf(router).length > 0, at);
});

test("라우터를 따로 붙여도: 로그인하지 않으면 401, 운영자가 아니면 403", async () => {
  let user: object | null = null;
  const app = express();
  app.use(signedInAs(() => user));
  for (const [at, router] of ADMIN_MOUNTS) app.use(at, router);
  app.use("/api/app-emojis", appEmojisRouter);
  const server = await listenForFetch(app);
  try {
    const base = baseUrl(server);
    const targets: Array<[string, string]> = [...ADMIN.map(([m, at, p]): [string, string] => [m, at + (p === "/" ? "" : p)]), ...OUTSIDE.map(([m, p]): [string, string] => [m, "/api/app-emojis" + (p === "/" ? "" : p)])];
    const wrong: string[] = [];
    for (const [who, want] of [
      [null, 401],
      [{ id: "someone", username: "someone" }, 403],
    ] as const) {
      user = who;
      for (const [method, url] of targets) {
        const res = await fetch(base + url, { method, signal: AbortSignal.timeout(3000) });
        if (res.status !== want) wrong.push(`${method} ${url} → ${res.status}(기대 ${want})`);
        await res.body?.cancel();
      }
    }
    assert.deepEqual(wrong, []);
  } finally {
    server.close();
  }
});

let server: Server;
let base: string;
let sessionUser: object | null = null;
// 실제 앱의 세션 자리. CSRF 토큰을 맞춰 두어 주인 문까지 닿게 한다
const TOKEN = "t".repeat(43);
const fakeSession = (req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({ user: sessionUser ?? undefined, loginAt: Date.now(), csrfToken: TOKEN });
  next();
};
let limit: number;

before(async () => {
  limit = config.dashboard.rateLimit.apiMax;
  config.dashboard.rateLimit.apiMax = 1_000_000;
  const deployCommands = () => assert.fail("이 시험은 명령을 등록하지 않는다");
  server = await listenForFetch(createApp(fakeBot({ client: { user: null } }), { stream: createPlayerStream(), deployCommands, sessionMiddleware: fakeSession }), "127.0.0.1");
  base = baseUrl(server);
});
after(() => {
  config.dashboard.rateLimit.apiMax = limit;
  server.close();
});

test("실제 앱에서도: 운영자 패널의 모든 경로와 밖의 운영자 전용 경로가 로그인하지 않으면 401, 운영자가 아니면 403", async () => {
  const targets: Array<[string, string]> = [...ADMIN.map(([m, at, p]): [string, string] => [m, at + (p === "/" ? "" : p)]), ...OUTSIDE.map(([m, p]): [string, string] => [m, "/api/app-emojis" + (p === "/" ? "" : p)])];
  const wrong: string[] = [];
  for (const [who, want] of [
    [null, 401],
    [{ id: "someone", username: "someone" }, 403],
  ] as const) {
    sessionUser = who;
    for (const [method, url] of targets) {
      const res = await fetch(base + url, { method, headers: { "x-csrf-token": TOKEN }, signal: AbortSignal.timeout(3000) });
      if (res.status !== want) wrong.push(`${method} ${url} → ${res.status}(기대 ${want})`);
      await res.body?.cancel();
    }
  }
  sessionUser = null;
  assert.deepEqual(wrong, []);
});

test("실제 앱의 /api/admin 앞 문: 라우터에 검사가 없어도 막는다", async () => {
  // 검사 없는 경로를 운영자 라우터 하나에 잠깐 더한다(표의 마지막, /api/admin 에 붙은 것)
  const [, last] = ADMIN_MOUNTS[ADMIN_MOUNTS.length - 1];
  const stack = last.stack as unknown as unknown[];
  const guard = stack.shift();
  last.get("/__unguarded", (_req, res) => {
    res.json({ open: true });
  });
  try {
    for (const [who, want] of [
      [null, 401],
      [{ id: "someone", username: "someone" }, 403],
    ] as const) {
      sessionUser = who;
      const res = await fetch(`${base}/api/admin/__unguarded`, { signal: AbortSignal.timeout(3000) });
      assert.equal(res.status, want);
    }
  } finally {
    sessionUser = null;
    stack.pop();
    stack.unshift(guard);
  }
});
