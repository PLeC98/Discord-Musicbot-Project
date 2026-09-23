"use strict";

// logger facade + LogManager sink 단위 테스트 (네트워크/DB 없음).
// facade는 sink 없이 buildRecord/게이팅/child를, sink는 격리 인스턴스(intercept:false)로 검증.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const logger = require("../../src/infra/log/logger");
const sink = require("../../src/infra/log/sink");
const { buildRecord, createLogger, LEVELS } = logger._internals;
const { LogManager } = sink;

// ── facade: 인자 파싱/레코드 형태 ─────────────────────────────
test("buildRecord: (msg, ...interp) — util.format 적용", () => {
  const r = buildRecord(LEVELS.info, {}, ["안녕 %s", "세계"]);
  assert.equal(r.level, 30);
  assert.equal(r.msg, "안녕 세계");
  assert.equal(typeof r.time, "number");
});

test("buildRecord: (mergingObj, msg) — 바인딩이 top-level로 병합", () => {
  const r = buildRecord(LEVELS.warn, { category: "youtube" }, [{ guildId: "42" }, "실패"]);
  assert.equal(r.level, 40);
  assert.equal(r.msg, "실패");
  assert.equal(r.category, "youtube"); // child 바인딩
  assert.equal(r.guildId, "42"); // 호출부 merging object
});

test("buildRecord: (err) — err는 필드로 남고 stack이 msg에 접붙음", () => {
  const e = new Error("펑");
  const r = buildRecord(LEVELS.error, {}, [e]);
  assert.match(r.msg, /펑/);
  assert.equal(typeof r.err, "string"); // Error → stack 문자열로 치환
  assert.match(r.err, /펑/);
});

test("buildRecord: (obj) 단독 — msg 빈 문자열", () => {
  const r = buildRecord(LEVELS.info, {}, [{ a: 1 }]);
  assert.equal(r.msg, "");
  assert.equal(r.a, 1);
});

// ── facade: 레벨 게이팅 / child ──────────────────────────────
test("레벨 게이팅: 현재 레벨 미만은 sink.record 미호출", () => {
  const log = createLogger({}, "info");
  const calls = [];
  const orig = sink.record;
  sink.record = (r) => calls.push(r);
  try {
    log.debug("이건 무시"); // 20 < 30
    log.info("이건 통과"); // 30 >= 30
  } finally {
    sink.record = orig;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msg, "이건 통과");
});

test("level 세터로 게이팅 조정 가능", () => {
  const log = createLogger({}, "info");
  log.level = "debug";
  assert.equal(log.level, "debug");
  const calls = [];
  const orig = sink.record;
  sink.record = (r) => calls.push(r);
  try {
    log.debug("이제 통과");
  } finally {
    sink.record = orig;
  }
  assert.equal(calls.length, 1);
});

test("child: 바인딩 병합, 부모 레벨 상속", () => {
  const parent = createLogger({ category: "a" }, "warn");
  const child = parent.child({ sub: "b" });
  assert.equal(child.level, "warn");
  const calls = [];
  const orig = sink.record;
  sink.record = (r) => calls.push(r);
  try {
    child.error("x");
  } finally {
    sink.record = orig;
  }
  assert.equal(calls[0].category, "a");
  assert.equal(calls[0].sub, "b");
});

test("logger.log()는 노출되지 않음 (pino 표면)", () => {
  assert.equal(typeof logger.log, "undefined");
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.fatal, "function");
});

// ── sink: 레드액션 ──────────────────────────────────────────
test("레드액션: 민감 키 값 마스킹", () => {
  const lm = new LogManager({ intercept: false });
  lm.useColor = false;
  const got = [];
  lm.destinations.push((r) => got.push(r));
  const stub = () => {};
  lm._renderTerminal = stub; // 터미널 소음 억제
  lm.record({ level: 30, time: Date.now(), msg: "ok", access_token: "SECRET123", guildId: "9" });
  assert.equal(got[0].access_token, "[REDACTED]");
  assert.equal(got[0].guildId, "9"); // 무해 필드는 보존
});

test("레드액션: msg 내 Bearer 토큰 마스킹", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  const got = [];
  lm.destinations.push((r) => got.push(r));
  lm.record({ level: 30, time: Date.now(), msg: "auth Bearer abcDEF123456ghized" });
  assert.match(got[0].msg, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(got[0].msg, /abcDEF123456/);
});

// ── sink: 와이어 투영 / 버퍼 ────────────────────────────────
test("와이어 투영: {ts,level,text} + ANSI 스트립", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  lm.record({ level: 40, time: 123, msg: "\x1B[33m노랑\x1B[39m" });
  const entry = lm.buffer[0];
  assert.deepEqual(entry, { ts: 123, level: "warn", text: "노랑" });
});

// 브리지에 걸리는 console.log은 전부 서드파티다 — info로 올리면 우리 로그가 묻힌다.
test("브리지: console.log은 debug로 기록되고 와이어에도 debug로 나간다", () => {
  assert.equal(sink._internals.CONSOLE_LEVEL.log, 20);
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  lm.record({ level: sink._internals.CONSOLE_LEVEL.log, time: 1, msg: "x", category: "external" });
  assert.equal(lm.buffer[0].level, "debug");
});

// 예전엔 대시보드가 아는 네 가지(log/info/warn/error)로 접어서 보냈다. 그러면 debug와 trace가,
// fatal과 error가 합쳐져 대시보드가 영영 못 가른다 — 레벨을 실제로 쓰기 시작한 이상 접으면 안 된다.
test("와이어 레벨은 실제 이름을 그대로 보낸다 (접지 않는다)", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  for (const [i, lv] of [10, 20, 30, 40, 50, 60].entries()) lm.record({ level: lv, time: i, msg: "m" });
  assert.deepEqual(
    lm.buffer.map((e) => e.level),
    ["trace", "debug", "info", "warn", "error", "fatal"],
  );
});

test("터미널 하한은 파일·대시보드에 영향을 주지 않는다", () => {
  const lm = new LogManager({ intercept: false });
  const printed = [];
  lm._renderTerminal = (rec) => printed.push(rec.level);
  lm.setConsoleLevel("info");

  lm.record({ level: 20, time: 1, msg: "debug" });
  lm.record({ level: 30, time: 2, msg: "info" });

  assert.deepEqual(printed, [30], "터미널엔 info부터");
  assert.equal(lm.buffer.length, 2, "버퍼(=대시보드·파일 경로)는 둘 다 받는다");
});

test("링버퍼: maxLines 초과 시 오래된 것부터 폐기", () => {
  const lm = new LogManager({ intercept: false, maxLines: 3 });
  lm._renderTerminal = () => {};
  for (let i = 0; i < 5; i++) lm.record({ level: 30, time: i, msg: `m${i}` });
  assert.equal(lm.buffer.length, 3);
  assert.deepEqual(
    lm.buffer.map((e) => e.text),
    ["m2", "m3", "m4"],
  );
});

// 관리자 로그 스트림에는 연결 상한도 느린 소비자 처리도 없었다(감사 L-04).
// 상한·하트비트는 대시보드 SSE와 같은 설정을 쓴다.
function fakeRes({ writeResult = true } = {}) {
  const res = {
    writes: [],
    ended: false,
    statusCode: null,
    body: null,
    handlers: {},
    writeHead() {},
    flushHeaders() {},
    write(p) {
      res.writes.push(p);
      return writeResult;
    },
    end() {
      res.ended = true;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(b) {
      res.body = b;
      return res;
    },
    on(event, fn) {
      res.handlers[event] = fn;
    },
  };
  return res;
}

test("관리자 SSE: 연결 상한을 넘으면 429 — 무한정 받지 않는다", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  const { maxPerUser } = require("../../config").dashboard.sse;

  for (let i = 0; i < maxPerUser; i++) lm.addClient(fakeRes());
  assert.equal(lm.clients.size, maxPerUser);

  const over = fakeRes();
  lm.addClient(over);
  assert.equal(over.statusCode, 429);
  assert.equal(lm.clients.size, maxPerUser, "상한을 넘는 연결은 등록하지 않는다");
});

test("관리자 SSE: 읽지 않는 소비자는 끊는다 — 버퍼가 쌓이게 두지 않는다", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};

  const slow = fakeRes({ writeResult: false }); // write가 false = 커널 버퍼가 참
  lm.addClient(slow);
  assert.equal(lm.clients.size, 1);

  lm.record({ level: 30, time: 1, msg: "한 줄" });
  assert.equal(slow.ended, true);
  assert.equal(lm.clients.size, 0, "정리까지 되어야 다음 기록에서 다시 만나지 않는다");
});

test("관리자 SSE: 연결이 닫히면 하트비트도 함께 걷는다", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};

  const res = fakeRes();
  lm.addClient(res);
  assert.equal(typeof res.handlers.close, "function");
  assert.equal(typeof res.handlers.error, "function");

  res.handlers.close();
  res.handlers.close(); // 두 번 와도 한 번만
  assert.equal(lm.clients.size, 0);
});

test("SSE 브로드캐스트: 등록된 클라이언트에 data 프레임 전송", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  const writes = [];
  lm.clients.add({ write: (p) => writes.push(p) });
  lm.record({ level: 50, time: 7, msg: "err" });
  assert.equal(writes.length, 1);
  assert.match(writes[0], /^data: /);
  const parsed = JSON.parse(writes[0].slice(6));
  assert.deepEqual(parsed, { ts: 7, level: "error", text: "err" });
});
