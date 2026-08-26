"use strict";

// logger facade + LogManager sink 단위 테스트 (네트워크/DB 없음).
// facade는 sink 없이 buildRecord/게이팅/child를, sink는 격리 인스턴스(intercept:false)로 검증.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const logger = require("../src/logger");
const sink = require("../src/LogManager");
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

// ── sink: 와이어 투영 / 버퍼 / 하위호환 ─────────────────────
test("와이어 투영: {ts,level,text} + ANSI 스트립", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  lm.record({ level: 40, time: 123, msg: "\x1B[33m노랑\x1B[39m" });
  const entry = lm.buffer[0];
  assert.deepEqual(entry, { ts: 123, level: "warn", text: "노랑" });
});

test("와이어 하위호환: wireLevel이 대시보드 칩 이름을 그대로 유지", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  // 브리지 레거시 console.log → level 30이지만 wireLevel "log"로 옛 칩 보존
  lm.record({ level: 30, time: 1, msg: "x", wireLevel: "log" });
  assert.equal(lm.buffer[0].level, "log");
});

test("와이어 매핑: facade 레벨 → 옛 칩(trace/debug→log, fatal→error)", () => {
  const lm = new LogManager({ intercept: false });
  lm._renderTerminal = () => {};
  lm.record({ level: 10, time: 1, msg: "t" });
  lm.record({ level: 60, time: 2, msg: "f" });
  assert.equal(lm.buffer[0].level, "log"); // trace
  assert.equal(lm.buffer[1].level, "error"); // fatal
});

test("링버퍼: maxLines 초과 시 오래된 것부터 폐기", () => {
  const lm = new LogManager({ intercept: false, maxLines: 3 });
  lm._renderTerminal = () => {};
  for (let i = 0; i < 5; i++) lm.record({ level: 30, time: i, msg: `m${i}` });
  assert.equal(lm.buffer.length, 3);
  assert.deepEqual(lm.buffer.map((e) => e.text), ["m2", "m3", "m4"]);
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
