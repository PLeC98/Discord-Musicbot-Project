// logger facade + LogManager sink 단위 테스트 (네트워크/DB 없음).
// facade는 sink 없이 buildRecord/게이팅/child를, sink는 격리 인스턴스(intercept:false)로 검증.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogRecord } from "../../src/infra/log/sink.ts";

import logger from "../../src/infra/log/logger.ts";
import sink from "../../src/infra/log/sink.ts";
import config from "../../src/config/index.ts";
const { buildRecord, createLogger, LEVELS } = logger._internals;
const { LogManager } = sink;
// 터미널 소음 억제
const quiet = () => {};

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
  assert.match(String(r.err), /펑/);
});

test("buildRecord: (obj) 단독 — msg 빈 문자열", () => {
  const r = buildRecord(LEVELS.info, {}, [{ a: 1 }]);
  assert.equal(r.msg, "");
  assert.equal(r.a, 1);
});

// ── facade: 레벨 게이팅 / child ──────────────────────────────
test("레벨 게이팅: 현재 레벨 미만은 기록하지 않는다", () => {
  const calls: LogRecord[] = [];
  const log = createLogger({}, "info", (r) => calls.push(r));
  log.debug("이건 무시"); // 20 < 30
  log.info("이건 통과"); // 30 >= 30
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msg, "이건 통과");
});

test("level 세터로 게이팅 조정 가능", () => {
  const calls: LogRecord[] = [];
  const log = createLogger({}, "info", (r) => calls.push(r));
  log.level = "debug";
  assert.equal(log.level, "debug");
  log.debug("이제 통과");
  assert.equal(calls.length, 1);
});

test("child: 바인딩 병합, 부모 레벨 상속", () => {
  const calls: LogRecord[] = [];
  const parent = createLogger({ category: "a" }, "warn", (r) => calls.push(r));
  const child = parent.child({ sub: "b" });
  assert.equal(child.level, "warn");
  child.error("x");
  assert.equal(calls[0].category, "a");
  assert.equal(calls[0].sub, "b");
});

test("logger.log()는 노출되지 않음 (pino 표면)", () => {
  assert.equal(Reflect.get(logger, "log"), undefined);
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.fatal, "function");
});

// ── sink: 레드액션 ──────────────────────────────────────────
test("레드액션: 민감 키 값 마스킹", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });
  lm.useColor = false;
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  lm.record({ level: 30, time: Date.now(), msg: "ok", access_token: "SECRET123", guildId: "9" });
  assert.equal(got[0].access_token, "[REDACTED]");
  assert.equal(got[0].guildId, "9"); // 무해 필드는 보존
});

test("레드액션: msg 내 Bearer 토큰 마스킹", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  lm.record({ level: 30, time: Date.now(), msg: "auth Bearer abcDEF123456ghized" });
  assert.match(String(got[0].msg), /Bearer \[REDACTED\]/);
  assert.doesNotMatch(String(got[0].msg), /abcDEF123456/);
});

// ── sink: 와이어 투영 / 버퍼 ────────────────────────────────
test("와이어 투영: {id,ts,level,text} + ANSI 스트립", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });
  lm.record({ level: 40, time: 123, msg: "\x1B[33m노랑\x1B[39m" });
  const entry = lm.buffer[0];
  assert.deepEqual(entry, { id: 1, ts: 123, level: "warn", text: "노랑" });
});

// 브리지에 걸리는 console.log은 전부 서드파티다 — info로 올리면 우리 로그가 묻힌다.
test("브리지: console.log은 debug로 기록되고 와이어에도 debug로 나간다", () => {
  assert.equal(sink._internals.CONSOLE_LEVEL.log, 20);
  const lm = new LogManager({ intercept: false, terminal: quiet });
  lm.record({ level: sink._internals.CONSOLE_LEVEL.log, time: 1, msg: "x", category: "external" });
  assert.equal(lm.buffer[0].level, "debug");
});

// 예전엔 대시보드가 아는 네 가지(log/info/warn/error)로 접어서 보냈다. 그러면 debug와 trace가,
// fatal과 error가 합쳐져 대시보드가 영영 못 가른다 — 레벨을 실제로 쓰기 시작한 이상 접으면 안 된다.
test("와이어 레벨은 실제 이름을 그대로 보낸다 (접지 않는다)", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });
  for (const [i, lv] of [10, 20, 30, 40, 50, 60].entries()) lm.record({ level: lv, time: i, msg: "m" });
  assert.deepEqual(
    lm.buffer.map((e) => e.level),
    ["trace", "debug", "info", "warn", "error", "fatal"],
  );
});

test("터미널 하한은 파일·대시보드에 영향을 주지 않는다", () => {
  const printed: number[] = [];
  const lm = new LogManager({ intercept: false, terminal: (rec) => printed.push(rec.level) });
  lm.setConsoleLevel("info");

  lm.record({ level: 20, time: 1, msg: "debug" });
  lm.record({ level: 30, time: 2, msg: "info" });

  assert.deepEqual(printed, [30], "터미널엔 info부터");
  assert.equal(lm.buffer.length, 2, "버퍼(=대시보드·파일 경로)는 둘 다 받는다");
});

test("링버퍼: maxLines 초과 시 오래된 것부터 폐기", () => {
  const lm = new LogManager({ intercept: false, maxLines: 3, terminal: quiet });
  for (let i = 0; i < 5; i++) lm.record({ level: 30, time: i, msg: `m${i}` });
  assert.equal(lm.buffer.length, 3);
  assert.deepEqual(
    lm.buffer.map((e) => e.text),
    ["m2", "m3", "m4"],
  );
});

// 관리자 로그 스트림에는 연결 상한도 느린 소비자 처리도 없었다(감사 L-04).
// 상한·하트비트는 대시보드 SSE와 같은 설정을 쓴다.
function fakeRes({ writeResult = true, writableLength = 0 } = {}) {
  const res = {
    writes: [] as string[],
    writableLength,
    ended: false,
    statusCode: null as number | null,
    body: null as unknown,
    handlers: {} as Record<string, () => void>,
    writeHead() {},
    flushHeaders() {},
    write(p: string) {
      res.writes.push(p);
      return writeResult;
    },
    end() {
      res.ended = true;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    on(event: string, fn: () => void) {
      res.handlers[event] = fn;
    },
  };
  return res;
}

test("관리자 SSE: 연결 상한은 사용자마다 센다(설정 이름대로). 넘으면 429 — 무한정 받지 않는다", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });
  const { maxPerUser } = config.dashboard.sse;

  for (let i = 0; i < maxPerUser; i++) lm.addClient(fakeRes(), "owner");
  assert.equal(lm.clients.size, maxPerUser);

  const over = fakeRes();
  assert.equal(lm.addClient(over, "owner"), false);
  assert.equal(over.statusCode, null, "답은 부른 경로가 문제 응답(too-many-streams)으로 쓴다");
  assert.equal(lm.clients.size, maxPerUser, "상한을 넘는 연결은 등록하지 않는다");

  const other = fakeRes();
  assert.equal(lm.addClient(other, "someone-else"), true, "다른 사용자는 따로 센다");
  assert.equal(lm.clients.size, maxPerUser + 1);
});

test("관리자 SSE: 쓰기가 잠깐 밀린 것으로는 끊지 않고, 밀린 양이 상한을 넘는(읽지 않는) 소비자만 끊는다", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });

  // 붙을 때 쌓인 줄을 한꺼번에 보내면 write 가 false 를 돌려준다. 그것만으로 끊으면 붙는 순간 로그가 나면 끊긴다
  const busy = fakeRes({ writeResult: false, writableLength: 100_000 });
  lm.addClient(busy, "owner");
  lm.record({ level: 30, time: 1, msg: "한 줄" });
  assert.equal(busy.ended, false);
  assert.equal(lm.clients.size, 1);

  const stuck = fakeRes({ writeResult: false, writableLength: 2 * 1024 * 1024 });
  lm.addClient(stuck, "owner");
  lm.record({ level: 30, time: 2, msg: "한 줄" });
  assert.equal(stuck.ended, true);
  assert.equal(lm.clients.size, 1, "정리까지 되어야 다음 기록에서 다시 만나지 않는다");
});

test("관리자 SSE: 붙는 중에 로그가 나도 끊기지 않는다(쌓인 500줄 약 100KB 를 보내는 중 한 줄, 진짜 HTTP)", async () => {
  const http = await import("node:http");
  const lm = new LogManager({ intercept: false, terminal: quiet });
  for (let i = 0; i < 500; i++) lm.record({ level: 30, time: i, msg: `줄 ${i} ` + "x".repeat(120) });
  const server = http.createServer((_req, res) => lm.addClient(res, "owner"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  let ended = false;
  let received = "";
  const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => (received += chunk));
    res.on("end", () => (ended = true));
  });
  await new Promise((done) => setTimeout(done, 10));
  lm.record({ level: 30, time: 9999, msg: "붙는 순간의 새 줄" });
  await new Promise((done) => setTimeout(done, 300));
  req.destroy();
  server.close();
  assert.equal(ended, false, "서버가 끊지 않았다");
  assert.match(received, /붙는 순간의 새 줄/);
});

test("관리자 SSE: 줄마다 기동표.번호를 싣고, 다시 붙으면 마지막 번호 뒤만 보낸다. 다른 실행의 번호면(봇을 다시 켬) reset 뒤 전부", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });
  for (let i = 1; i <= 3; i++) lm.record({ level: 30, time: i, msg: `줄 ${i}` });
  const ids = (res: ReturnType<typeof fakeRes>) => res.writes.flatMap((w) => [...w.matchAll(/^id: \d+\.(\d+)$/gm)].map((m) => Number(m[1])));

  const first = fakeRes();
  lm.addClient(first, "owner");
  assert.deepEqual(ids(first), [1, 2, 3]);

  const resumed = fakeRes();
  lm.addClient(resumed, "owner", `${lm.boot}.2`);
  assert.deepEqual(ids(resumed), [3], "이미 받은 줄은 다시 보내지 않는다");

  const restarted = fakeRes();
  lm.addClient(restarted, "owner", `${lm.boot - 1}.2`);
  assert.match(restarted.writes[0], /^event: reset\n/);
  assert.deepEqual(ids(restarted), [1, 2, 3]);
});

test("관리자 SSE: 연결이 닫히면 하트비트도 함께 걷는다", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });

  const res = fakeRes();
  lm.addClient(res, "owner");
  assert.equal(typeof res.handlers.close, "function");
  assert.equal(typeof res.handlers.error, "function");

  res.handlers.close();
  res.handlers.close(); // 두 번 와도 한 번만
  assert.equal(lm.clients.size, 0);
});

test("SSE 브로드캐스트: 등록된 클라이언트에 data 프레임 전송", () => {
  const lm = new LogManager({ intercept: false, terminal: quiet });
  const res = fakeRes();
  lm.clients.add(res);
  lm.record({ level: 50, time: 7, msg: "err" });
  assert.equal(res.writes.length, 1);
  assert.equal(res.writes[0].split("\n")[0], `id: ${lm.boot}.1`);
  const parsed = JSON.parse(res.writes[0].split("data: ")[1]);
  assert.deepEqual(parsed, { id: 1, ts: 7, level: "error", text: "err" });
});
