// src/dashboard — 오류 응답에서 내부 정보가 새지 않는지, 그리고 그것이 가능하도록
// 미들웨어가 올바른 순서로 등록되는지.
//
// 회귀 대상: 세션 스토어가 죽었을 때 (1) 브라우저에 전체 스택 트레이스가 찍히던 것,
// (2) 정적 자산까지 세션 뒤에 있어 앱 껍데기조차 못 뜨고 백지가 되던 것.
//
// 실 앱(createApp)을 임의 포트에 띄운다 — 순서 자체가 검증 대상이라 축소판으로는 의미가 없다.
// 세션 미들웨어만 "저장장치가 죽은 상태"로 넘긴다.

import fs from "node:fs";
import path from "node:path";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { baseUrl } from "../helpers/listen.ts";
import logSink from "../../src/infra/log/sink.ts";
import { PROBLEMS } from "../../src/rules/problems.ts";
import { notice } from "../../src/ui/text/ko/errors.ts";

// ── 로그: 싱크에 받는 곳을 달아 본다(errorId가 로그에도 남는지 확인용) ──────
const logLines: string[] = [];
logSink.addDestination((rec: unknown) => logLines.push(JSON.stringify(rec)));

// ── 로그인 세션: "언마운트로 스토어가 죽은" 상태. 실 SQLite를 건드리지 않는다 ──────────────
let storeBroken = true;
const brokenSession = (req: Request, _res: Response, next: NextFunction) => {
  if (storeBroken) {
    // better-sqlite3가 언마운트된 볼륨에서 실제로 던지는 모양
    return next(Object.assign(new Error("database disk image is malformed"), { name: "SqliteError", code: "SQLITE_CORRUPT" }));
  }
  req.session = fake<Request["session"]>({});
  next();
};

// ── 서버 설정: 진짜를 임시 DB 로 ──────────────────────────
const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("dashboard-errors-");
after(() => store.close());

const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { describeBinding, isLoopbackHost } = await import("../../src/dashboard/binding.ts");
const { _internals } = await import("../../src/dashboard/middleware/error-handler.ts");
const { errorHandler } = await import("../../src/dashboard/middleware/error-handler.ts");

const HAS_DIST = fs.existsSync(path.join(import.meta.dirname, "..", "..", "dashboard", "dist", "index.html"));

let server: Server;
let base: string;

before(async () => {
  const deployCommands = () => assert.fail("이 시험은 명령을 등록하지 않는다");
  server = createApp(fakeBot({ client: { user: null } }), { stream: createPlayerStream(), deployCommands, sessionMiddleware: brokenSession }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = baseUrl(server);
});

after(() => server.close());

async function req(urlPath: string, init: RequestInit = {}) {
  const res = await fetch(base + urlPath, { signal: AbortSignal.timeout(3000), ...init });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

// ── 오류 분류 (순수) ───────────────────────────────────────────────────────────

test("분류: SQLITE_*·I/O 오류는 storage-unavailable(503), 4xx는 bad-request(400), 나머지는 unknown-error(500)", () => {
  const c = _internals.classify;

  for (const code of ["SQLITE_CORRUPT", "SQLITE_NOTADB", "EIO", "ENOENT"]) assert.equal(c(Object.assign(new Error("x"), { code })), "storage-unavailable", code);
  assert.equal(PROBLEMS["storage-unavailable"].status, 503);

  // express.json()이 잘못된 본문에 붙이는 400 — 500으로 뭉개면 안 된다
  assert.equal(c(Object.assign(new Error("x"), { status: 400 })), "bad-request");
  assert.equal(c(Object.assign(new Error("x"), { statusCode: 403 })), "bad-request");

  assert.equal(c(new Error("그냥 버그")), "unknown-error");
  // 5xx를 err.status로 들고 와도 우리 분류를 거친다
  assert.equal(c(Object.assign(new Error("x"), { status: 502 })), "unknown-error");
});

// 2026-09-15 사용자 보고: 긴 공지를 보내면 대시보드에 "발송 실패"만 떠 무엇을 고칠지 알 수 없었다.
// 내부 사정은 감추되 무엇을 고쳐야 하는지는 알려 준다.
test("분류: 413·429는 고칠 방법이 드러나는 코드를 준다", () => {
  assert.equal(_internals.classify(Object.assign(new Error("request entity too large"), { status: 413, type: "entity.too.large" })), "payload-too-large");
  assert.match(notice("payload-too-large").body ?? "", /줄여서/);
  assert.equal(_internals.classify(Object.assign(new Error("x"), { status: 429 })), "too-many-requests");
});

test("헤더가 이미 나간 응답(SSE)은 건드리지 않고 넘긴다", () => {
  let passed = null;
  const res = {
    headersSent: true,
    status() {
      throw new Error("headersSent인데 응답을 다시 썼다");
    },
  };
  const err = new Error("boom");
  errorHandler(err, fake<Request>({ method: "GET", originalUrl: "/api/x", path: "/api/x" }), fake<Response>(res), (e) => (passed = e));
  assert.equal(passed, err);
});

// ── 기동 로그 문구 ─────────────────────────────────────────────────────────────

test("바인딩 안내: 루프백은 조용히, 외부+http는 경고", () => {
  const loopback = describeBinding("127.0.0.1", 33333, "http://localhost:33333");
  assert.match(loopback.line, /127\.0\.0\.1:33333/);
  assert.match(loopback.line, /DASHBOARD_HOST/); // "왜 다른 기기에서 안 붙지" 시간을 없앤다
  assert.deepEqual(loopback.warnings, []);

  const openPlain = describeBinding("0.0.0.0", 33333, "http://example.com");
  assert.match(openPlain.line, /0\.0\.0\.0:33333/);
  assert.match(openPlain.line, /모든 인터페이스/);
  assert.equal(openPlain.warnings.length, 1);
  assert.match(openPlain.warnings[0], /평문 HTTP/);

  // https로 선언했으면 통과 — 실제로 평문인 경우는 요청 시점의 그물이 잡는다
  assert.deepEqual(describeBinding("0.0.0.0", 33333, "https://example.com").warnings, []);

  // 특정 IP 바인딩은 "모든 인터페이스"가 아니다
  assert.match(describeBinding("192.168.0.10", 33333, "https://example.com").line, /외부 접속 허용/);

  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
});

// ── 실 앱: 스토어가 죽은 상태 ──────────────────────────────────────────────────

test("스토어가 죽어도 스택·내부 경로가 응답에 실리지 않는다", async () => {
  logLines.length = 0;
  const res = await req("/api/me");

  assert.equal(res.status, 503, "저장장치 장애는 재시도 가능한 상태");
  assert.match(res.headers.get("content-type") || "", /application\/problem\+json/);

  const json = JSON.parse(res.body);
  assert.deepEqual([json.type, json.code, json.status], ["/problems/storage-unavailable", "storage-unavailable", 503]);
  assert.match(json.errorId, /^[0-9a-f]{8}$/);
  assert.ok(!res.body.includes("    at "), "스택 프레임");
  assert.ok(!res.body.includes("malformed"), "내부 오류 메시지");
  assert.ok(!res.body.includes("SqliteError"));
  assert.ok(!/node_modules|[A-Za-z]:\\|\/home\/|\/media\//.test(res.body), "내부 경로");

  // 진단 가능성: 같은 ID로 서버 로그에서 찾을 수 있어야 한다
  const logged = logLines.filter((l) => l.includes(json.errorId));
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes("malformed"), "전체 오류는 로그에만");
});

test("코드 설명 주소(/problems/<코드>)는 화면(SPA) 폴백보다 먼저 받는다. 세션과 무관하다", async () => {
  const res = await req("/problems/queue-full");
  assert.equal(res.status, 200);
  assert.match(res.body, /<h1>queue-full<\/h1>/);
});

test("스토어가 죽어도 앱 껍데기는 뜬다 (백지 회귀)", async () => {
  const res = await req("/");
  assert.equal(res.status, 200);
  assert.ok(res.body.includes("<"), "HTML이 와야 한다");

  if (HAS_DIST) {
    assert.ok(res.body.includes("/assets/"), "빌드된 SPA의 index.html");
    const asset = res.body.match(/\/assets\/[\w.-]+\.css/)?.[0];
    if (asset) assert.equal((await req(asset)).status, 200, "정적 자산도 세션과 무관해야 한다");
  }
});

// ── 응답 헤더 ─────────────────────────────────────────────────────────────────

test("보안 헤더: 넣기로 한 것만 있고, 넣으면 안 되는 것은 없다", async () => {
  const { headers } = await req("/");

  assert.match(headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(headers.get("content-security-policy") || "", /img-src 'self' data: blob: https:/); // 외부 CDN 썸네일 · 화면이 흐려 만든 배경화면
  assert.match(headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("referrer-policy"), "no-referrer");

  assert.equal(headers.get("x-powered-by"), null, "서버 스택 광고");
  // 아래 셋은 의도적으로 넣지 않는다 — 남의 운영 환경을 깨뜨린다 (HSTS: 평문 호스트 영구 고정,
  // COEP: 외부 CDN 썸네일 전면 차단, COOP: 팝업 OAuth 무음 파손)
  assert.equal(headers.get("strict-transport-security"), null);
  assert.equal(headers.get("cross-origin-embedder-policy"), null);
  assert.equal(headers.get("cross-origin-opener-policy"), null);
});

// ── 실 앱: 스토어 정상 ─────────────────────────────────────────────────────────

test("등록되지 않은 /api 경로는 HTML이 아니라 문제 응답 404", async () => {
  storeBroken = false;
  try {
    const res = await req("/api/definitely-not-a-route");
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") || "", /application\/problem\+json/);
    // 클라이언트가 code 로 문장을 고른다
    assert.equal(JSON.parse(res.body).code, "route-not-found");
  } finally {
    storeBroken = true;
  }
});

test("잘못된 JSON 본문은 400 — 500으로 뭉개지 않는다", async () => {
  storeBroken = false;
  try {
    const res = await req("/api/guilds/x/player/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not json",
    });
    assert.equal(res.status, 400);
    assert.match(res.headers.get("content-type") || "", /application\/problem\+json/);
    assert.equal(JSON.parse(res.body).code, "bad-request");
    assert.match(JSON.parse(res.body).errorId, /^[0-9a-f]{8}$/);
    assert.ok(!res.body.includes("    at "));
  } finally {
    storeBroken = true;
  }
});
