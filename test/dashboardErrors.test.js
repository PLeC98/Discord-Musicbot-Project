"use strict";

// dashboard/server — 오류 응답에서 내부 정보가 새지 않는지, 그리고 그것이 가능하도록
// 미들웨어가 올바른 순서로 등록되는지.
//
// 회귀 대상: 세션 스토어가 죽었을 때 (1) 브라우저에 전체 스택 트레이스가 찍히던 것,
// (2) 정적 자산까지 세션 뒤에 있어 앱 껍데기조차 못 뜨고 백지가 되던 것.
//
// 실 앱(createApp)을 임의 포트에 띄운다 — 순서 자체가 검증 대상이라 축소판으로는 의미가 없다.
// 세션 미들웨어만 "저장장치가 죽은 상태"로 갈아끼운다.

const fs = require("node:fs");
const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// ── 로거 모킹 (다른 모듈이 require 하기 전에 — errorId가 로그에도 남는지 확인용) ──────
const logLines = [];
const logPath = require.resolve(path.join(__dirname, "..", "src", "logger.js"));
const fakeLog = {
  info: (...a) => logLines.push(a.join(" ")),
  warn: (...a) => logLines.push(a.join(" ")),
  error: (...a) => logLines.push(a.join(" ")),
  debug: () => {},
  bind: () => fakeLog,
  child: () => fakeLog,
};
require.cache[logPath] = { id: logPath, filename: logPath, loaded: true, exports: fakeLog };

// ── 세션 스토어·세션 미들웨어 모킹 ──────────────────────────────────────────────
// 실 SQLite를 건드리지 않으면서 "언마운트로 스토어가 죽은" 상태를 재현한다.
const storePath = require.resolve(path.join(__dirname, "..", "dashboard", "server", "sessionStore.js"));
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: class FakeStore {} };

let storeBroken = true;
const sessionPath = require.resolve("express-session");
require.cache[sessionPath] = {
  id: sessionPath,
  filename: sessionPath,
  loaded: true,
  exports: () => (req, res, next) => {
    if (storeBroken) {
      // better-sqlite3가 언마운트된 볼륨에서 실제로 던지는 모양
      const err = new Error("database disk image is malformed");
      err.name = "SqliteError";
      err.code = "SQLITE_CORRUPT";
      return next(err);
    }
    req.session = {};
    next();
  },
};

// ── GuildSettingsManager 모킹 (라우터가 실 DB를 열지 않게) ─────────────────────
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "GuildSettingsManager.js"));
require.cache[gsmPath] = {
  id: gsmPath,
  filename: gsmPath,
  loaded: true,
  exports: {
    getDjRoles: async () => [],
    setDjRoles: async () => true,
    clearDjRoles: async () => {},
    getBotChannel: async () => null,
    setBotChannel: async () => true,
    clearBotChannel: async () => {},
    resolveSponsorBlock: () => ({ enabled: false, categories: [] }),
  },
};

const { createApp } = require("../dashboard/server/index.js");
const { describeBinding, isLoopbackHost } = require("../dashboard/server/binding.js");
const { _internals } = require("../dashboard/server/middleware/errorHandler.js");
const { errorHandler } = require("../dashboard/server/middleware/errorHandler.js");

const HAS_DIST = fs.existsSync(path.join(__dirname, "..", "dashboard", "client", "dist", "index.html"));

let server;
let base;

before(async () => {
  server = createApp({ user: null }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function req(urlPath, init = {}) {
  const res = await fetch(base + urlPath, { signal: AbortSignal.timeout(3000), ...init });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

// ── 오류 분류 (순수) ───────────────────────────────────────────────────────────

test("분류: SQLITE_*·I/O 오류는 503, 4xx는 그대로, 나머지는 500", () => {
  const c = (err) => _internals.classify(err).status;

  assert.equal(c(Object.assign(new Error("x"), { code: "SQLITE_CORRUPT" })), 503);
  assert.equal(c(Object.assign(new Error("x"), { code: "SQLITE_NOTADB" })), 503);
  assert.equal(c(Object.assign(new Error("x"), { code: "EIO" })), 503);
  assert.equal(c(Object.assign(new Error("x"), { code: "ENOENT" })), 503);

  // express.json()이 잘못된 본문에 붙이는 400 — 500으로 뭉개면 안 된다
  assert.equal(c(Object.assign(new Error("x"), { status: 400 })), 400);
  assert.equal(c(Object.assign(new Error("x"), { statusCode: 403 })), 403);

  assert.equal(c(new Error("그냥 버그")), 500);
  // 5xx를 err.status로 들고 와도 우리 분류를 거친다
  assert.equal(c(Object.assign(new Error("x"), { status: 502 })), 500);
});

test("분류: 어떤 경우에도 err.message를 사용자 문구로 쓰지 않는다", () => {
  const { message } = _internals.classify(Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" }));
  assert.ok(!message.includes("malformed"));
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
  errorHandler(err, { method: "GET", originalUrl: "/api/x", path: "/api/x" }, res, (e) => (passed = e));
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
  assert.match(res.headers.get("content-type") || "", /application\/json/);

  const json = JSON.parse(res.body);
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
  assert.match(headers.get("content-security-policy") || "", /img-src 'self' data: https:/); // 외부 CDN 썸네일
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

test("등록되지 않은 /api 경로는 HTML이 아니라 JSON 404", async () => {
  storeBroken = false;
  try {
    const res = await req("/api/definitely-not-a-route");
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    // 클라이언트가 e.response?.data?.error로 읽는다
    assert.ok(JSON.parse(res.body).error);
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
    assert.match(res.headers.get("content-type") || "", /application\/json/);
    assert.match(JSON.parse(res.body).errorId, /^[0-9a-f]{8}$/);
    assert.ok(!res.body.includes("    at "));
  } finally {
    storeBroken = true;
  }
});
