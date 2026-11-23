// src/infra/log/logger.ts, sink.ts: logger facade와 LogSink sink(네트워크, DB 없이).
// facade는 sink 없이 buildRecord/게이팅/child를, sink는 격리 인스턴스(intercept:false)로 검증.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { LogRecord } from "../../src/infra/log/sink.ts";

import logger from "../../src/infra/log/logger.ts";
import sink from "../../src/infra/log/sink.ts";
import config from "../../src/config/index.ts";
import { KEPT_LINES } from "../../src/infra/log/levels.ts";
import { FAILED_MARK, logText, renderLogText, takeRenderFailures, type LogText } from "../../src/infra/log/log-text.ts";
import { logRuleLine, ruleLogText } from "../../src/rules/text/index.ts";
import { rule } from "../../src/rules/rule-problem.ts";
const { buildRecord, createLogger, LEVELS } = logger._internals;
const { LogSink } = sink;
// 터미널 소음 억제
const quiet = () => {};

// ── facade: 인자 파싱/레코드 형태 ─────────────────────────────
test("buildRecord: (msg, ...interp). util.format 적용", () => {
  const r = buildRecord(LEVELS.info, {}, ["안녕 %s", "세계"]);
  assert.equal(r.level, 30);
  assert.equal(r.msg, "안녕 세계");
  assert.equal(typeof r.time, "number");
});

test("buildRecord: (mergingObj, msg). 바인딩이 top-level로 병합", () => {
  const r = buildRecord(LEVELS.warn, { category: "youtube" }, [{ guildId: "42" }, "실패"]);
  assert.equal(r.level, 40);
  assert.equal(r.msg, "실패");
  assert.equal(r.category, "youtube"); // child 바인딩
  assert.equal(r.guildId, "42"); // 호출부 merging object
});

test("buildRecord: (err). err는 필드로 남고 stack이 msg에 접붙음", () => {
  const e = new Error("펑");
  const r = buildRecord(LEVELS.error, {}, [e]);
  assert.match(r.msg, /펑/);
  assert.equal(typeof r.err, "string"); // Error → stack 문자열로 치환
  assert.match(String(r.err), /펑/);
});

test("buildRecord: (err, msg). err는 필드로, msg 뒤에 stack을 붙인다", () => {
  const e = new Error("펑");
  const r = buildRecord(LEVELS.error, {}, [e, "저장 실패"]);
  assert.match(r.msg, /^저장 실패 Error: 펑/);
  assert.match(String(r.err), /^Error: 펑/);
});

test("buildRecord: (msg, 덧붙인 값). util.format으로 이어 붙이고 Error는 err 필드가 아니다", () => {
  const e = new Error("펑");
  const r = buildRecord(LEVELS.error, {}, ["재생 실패:", e]);
  assert.match(r.msg, /^재생 실패: Error: 펑/);
  assert.equal(r.err, undefined);
});

test("buildRecord: (obj, msg, ...interp). 병합하고 util.format", () => {
  const r = buildRecord(LEVELS.info, {}, [{ tags: ["a"] }, "곡 %d개", 3]);
  assert.equal(r.msg, "곡 3개");
  assert.deepEqual(r.tags, ["a"]);
});

// ── facade: 문구(서술자) 형식 ─────────────────────────────
const demo = (args: Record<string, string | number | boolean | null | LogText> = {}, render = () => "문구 글") => logText("demo.line", args, render);

test("buildRecord: (문구). msg는 그린 글, event와 args를 싣는다", () => {
  const r = buildRecord(LEVELS.warn, { category: "player" }, [demo({ track: "곡", n: 2 })]);
  assert.equal(r.msg, "문구 글");
  assert.equal(r.event, "demo.line");
  assert.deepEqual(r.args, { track: "곡", n: 2 });
  assert.equal(r.category, "player");
});

test("buildRecord: (바인딩, 문구), (err, 문구)", () => {
  const bound = buildRecord(LEVELS.info, {}, [{ tags: ["a"] }, demo()]);
  assert.deepEqual([bound.msg, bound.event, bound.tags], ["문구 글", "demo.line", ["a"]]);
  const failed = buildRecord(LEVELS.error, {}, [new Error("펑"), demo()]);
  assert.match(failed.msg, /^문구 글 Error: 펑/);
  assert.match(String(failed.err), /^Error: 펑/);
  assert.equal(failed.event, "demo.line");
});

test("buildRecord: 문구 뒤에 값이 오면 형식 문자열로 쓰지 않고 차례대로 뒤에 붙이고(Error는 inspect), Error는 err로도 올린다", () => {
  const r = buildRecord(LEVELS.error, {}, [demo({}, () => "곡 %s 100%d"), "덧붙임", new Error("펑"), { a: 1 }]);
  assert.match(r.msg, /^곡 %s 100%d 덧붙임 Error: 펑[\s\S]* \{ a: 1 \}$/);
  assert.equal(r.msg.split("Error: 펑").length, 2, "스택을 두 번 붙이지 않는다");
  assert.match(String(r.err), /^Error: 펑/);
});

test("buildRecord: 글 뒤의 오류는 글 형식(util.format)과 같은 글로 남는다(오류 코드, 원인까지)", () => {
  const error = Object.assign(new Error("끊김"), { code: "ECONNRESET" });
  const legacy = buildRecord(LEVELS.warn, {}, ["저장 실패:", error]);
  const described = buildRecord(LEVELS.warn, {}, [demo({}, () => "저장 실패:"), error]);
  assert.equal(described.msg, legacy.msg);
  assert.match(described.msg, /ECONNRESET/);
});

test("buildRecord: 값 안의 서술자(라벨)는 레코드에 { event, args }로 싣는다", () => {
  const label = logText("demo.label", { id: 1 }, () => "라벨");
  const r = buildRecord(LEVELS.info, {}, [demo({ label })]);
  assert.deepEqual(r.args, { label: { event: "demo.label", args: { id: 1 } } });
  assert.deepEqual(JSON.parse(JSON.stringify(r.args)), r.args, "그대로 직렬화된다");
});

test("buildRecord: 문구 함수가 던져도 던지지 않고 표식이 붙은 대체 글을 남긴다", () => {
  const r = buildRecord(LEVELS.warn, {}, [
    demo({ n: 1 }, () => {
      throw new Error("x");
    }),
  ]);
  assert.equal(r.msg, `${FAILED_MARK} demo.line {"n":1}`);
  assert.equal(r.event, "demo.line");
  // 일부러 낸 실패라 꺼내 비운다(실행 전체 검사)
  assert.deepEqual(takeRenderFailures(), ["demo.line"]);
});

test("레벨에 걸러지는 줄은 문구를 그리지 않는다", () => {
  let renders = 0;
  const got: LogRecord[] = [];
  const l = createLogger({}, "warn", (rec) => got.push(rec));
  l.debug(demo({}, () => `글 ${++renders}`));
  assert.deepEqual([got.length, renders], [0, 0]);
  l.warn(demo({}, () => `글 ${++renders}`));
  assert.deepEqual([got.length, renders], [1, 1]);
});

test("규칙 문제를 로그 문구로: event는 rule.<코드>, 감싼 이유는 값 안의 서술자, 글은 logRuleLine과 같다", () => {
  const problem = rule("tune-value", { key: "LOG_LEVEL", value: "x" }, rule("one-of", { allowed: "a, b" }));
  const text = ruleLogText(problem);
  assert.equal(text.event, "rule.tune-value");
  assert.deepEqual(buildRecord(LEVELS.warn, {}, [text]).args, { key: "LOG_LEVEL", value: "x", cause: { event: "rule.one-of", args: { allowed: "a, b" } } });
  assert.equal(renderLogText(text), logRuleLine(problem));
});

test("buildRecord: (obj) 단독. msg 빈 문자열", () => {
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
  const lm = new LogSink({ intercept: false, terminal: quiet });
  lm.useColor = false;
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  lm.record({ level: 30, time: Date.now(), msg: "ok", access_token: "SECRET123", guildId: "9" });
  assert.equal(got[0].access_token, "[REDACTED]");
  assert.equal(got[0].guildId, "9"); // 무해 필드는 보존
});

test("레드액션: msg 내 Bearer 토큰 마스킹", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  lm.record({ level: 30, time: Date.now(), msg: "auth Bearer abcDEF123456ghized" });
  assert.match(String(got[0].msg), /Bearer \[REDACTED\]/);
  assert.doesNotMatch(String(got[0].msg), /abcDEF123456/);
});

test("레드액션: msg에 JSON으로 실린 토큰, 암호 키(음성 연결의 진행 줄 모양 그대로)", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  // op 0 참가: 토큰 글. op 4 세션 설명: 암호 키 배열. 상태 바뀜: 연결 정보의 토큰과 Uint8Array로 든 키(객체로 직렬화된다)
  const identify = `[WS] >> ${JSON.stringify({ op: 0, d: { server_id: "1", session_id: "abc", token: "voice-token-1234" } })}`;
  const description = `[WS] << ${JSON.stringify({ op: 4, d: { mode: "aead_aes256_gcm_rtpsize", secret_key: [11, 22, 33] } })}`;
  const state = `state change:\nfrom ${JSON.stringify({ code: 4, connectionOptions: { token: "voice-token-1234" }, connectionData: { secretKey: new Uint8Array([11, 22, 33]) } })}`;
  for (const msg of [identify, description, state, '[WS] << {"op":2,"d":{"ssrc":1}}']) lm.record({ level: 10, time: Date.now(), msg });
  const [a, b, c, plain] = got.map((r) => String(r.msg));
  for (const hidden of [a, b, c]) assert.doesNotMatch(hidden, /voice-token-1234|11,22,33|"0":11/, hidden);
  assert.match(a, /"token":"\[REDACTED\]"/);
  assert.match(b, /"secret_key":"\[REDACTED\]"/);
  assert.match(c, /"secretKey":"\[REDACTED\]"/);
  assert.equal(plain, '[WS] << {"op":2,"d":{"ssrc":1}}', "비밀이 없는 줄은 그대로");
});

test("레드액션: 메시지 패턴은 msg 밖의 글 값에도 건다(Error의 stack은 err에도 실린다)", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  const log = createLogger({ category: "test" }, null, (rec) => lm.record(rec));
  log.error(new Error("요청 실패 Bearer abcDEF123456ghized"));
  log.error({ body: JSON.stringify({ error: "x", token: "body-token-5678" }), status: 401 }, "토큰 교환 실패");
  const [thrown, bound] = got;
  for (const field of [thrown.msg, thrown.err]) {
    assert.match(String(field), /Bearer \[REDACTED\]/);
    assert.doesNotMatch(String(field), /abcDEF123456/);
  }
  assert.equal(bound.body, '{"error":"x","token":"[REDACTED]"}');
  assert.equal(bound.status, 401);
  assert.equal(bound.category, "test", "패턴에 걸리지 않는 글은 그대로");
});

test("레드액션: 문구 값(args)은 모든 깊이에서 키 이름과 글 값을 가리고, 원본 서술자는 바꾸지 않는다", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  const log = createLogger({}, null, (rec) => lm.record(rec));
  const label = logText("demo.label", { token: "inner-secret-1", note: "Bearer abcDEF123456ghized" }, () => "라벨");
  const text = logText("demo.line", { label, status: 401, long: "가".repeat(20_000) }, () => "글");
  log.warn(text);
  const args = got[0].args as { label: { args: { token: string; note: string } }; status: number; long: string };
  assert.equal(args.label.args.token, "[REDACTED]");
  assert.equal(args.label.args.note, "Bearer [REDACTED]");
  assert.equal(args.status, 401);
  assert.ok(args.long.length < 20_000, "글 값 길이 상한도 건다");
  assert.equal(label.args.token, "inner-secret-1", "원본 서술자는 그대로");
  assert.equal((text.args.long as string).length, 20_000);
});

// ── sink: 글 값의 길이 상한 ──────────────────────────────────
const HEAD = 12 * 1024;
const TAIL = 4 * 1024;

test("긴 글 값: 앞 12K자와 뒤 4K자를 남기고 가운데를 줄여 터미널, 줄 버퍼, 경고, SSE, destination이 같은 값을 받는다", () => {
  const terminal: LogRecord[] = [];
  const lm = new LogSink({ intercept: false, terminal: (r) => terminal.push(r) });
  const res = fakeRes();
  lm.clients.add(res);
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  const long = "H".repeat(13_000) + "M".repeat(10_000) + "T".repeat(5_000);
  const clipped = `${"H".repeat(HEAD)}…(가운데 ${long.length - HEAD - TAIL}자 생략)…${"T".repeat(TAIL)}`;
  const list = ["x".repeat(20_000)];
  lm.record({ level: 50, time: 7, msg: long, err: long, body: long, list, short: "짧은 글" });
  assert.equal(got[0].msg, clipped);
  assert.equal(got[0].err, clipped);
  assert.equal(got[0].body, clipped);
  assert.equal(got[0].list, list, "글 아닌 값은 그대로");
  assert.equal(got[0].short, "짧은 글");
  assert.equal(terminal[0].msg, clipped);
  assert.equal(lm.buffer[0].text, clipped);
  assert.equal(lm.problems[0].text, clipped);
  assert.equal(JSON.parse(res.writes[0].split("data: ")[1]).text, clipped);
});

test("긴 글 값: 상한까지는 그대로, 기동 초기 레코드도 잘린 채로 재생한다", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const exact = "가".repeat(HEAD + TAIL);
  lm.record({ level: 30, time: 1, msg: exact });
  lm.record({ level: 30, time: 2, msg: exact + "나" });
  const got: LogRecord[] = [];
  lm.addDestination((r) => got.push(r));
  assert.equal(got[0].msg, exact);
  assert.equal(got[1].msg, `${"가".repeat(HEAD)}…(가운데 1자 생략)…${"가".repeat(TAIL - 1)}나`);
});

test("긴 글 값: 가린 뒤에 자른다(잘린 자리에 걸린 토큰이 남지 않는다), 서로게이트 짝을 쪼개지 않는다", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const got: LogRecord[] = [];
  lm.destinations.push((r) => got.push(r));
  // 토큰이 앞 12K자의 끝에 걸친다: 자른 뒤에 가리면 "Bearer SEC"는 패턴(6자 이상)에 맞지 않아 남는다
  const straddle = "가".repeat(HEAD - 10) + "Bearer SECRETTOKENVALUE123 " + "가".repeat(20_000);
  // 앞의 끝과 뒤의 시작이 이모지의 가운데
  const emoji = "가".repeat(HEAD - 1) + "😀" + "나".repeat(5_000) + "😀" + "다".repeat(TAIL - 1);
  lm.record({ level: 30, time: 1, msg: straddle });
  lm.record({ level: 30, time: 2, msg: emoji });
  assert.doesNotMatch(String(got[0].msg), /SEC/);
  const text = String(got[1].msg);
  assert.ok(text.isWellFormed(), "짝 없는 서로게이트가 없다");
  assert.ok(text.startsWith("가".repeat(HEAD - 1) + "…") && text.endsWith("…" + "다".repeat(TAIL - 1)), text.slice(HEAD - 3, HEAD + 30));
});

// ── sink: 와이어 투영 / 버퍼 ────────────────────────────────
test("와이어 투영: {id,ts,level,text} + ANSI 스트립", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  lm.record({ level: 40, time: 123, msg: "\x1B[33m노랑\x1B[39m" });
  const entry = lm.buffer[0];
  assert.deepEqual(entry, { id: 1, ts: 123, level: "warn", text: "노랑" });
});

// 브리지에 걸리는 console.log는 전부 서드파티라 info로 올리면 우리 로그가 묻힌다.
test("브리지: console.log은 debug로 기록되고 와이어에도 debug로 나간다", () => {
  assert.equal(sink._internals.CONSOLE_LEVEL.log, 20);
  const lm = new LogSink({ intercept: false, terminal: quiet });
  lm.record({ level: sink._internals.CONSOLE_LEVEL.log, time: 1, msg: "x", category: "external" });
  assert.equal(lm.buffer[0].level, "debug");
});

// 대시보드가 아는 네 가지(log/info/warn/error)로 접어 보내면 debug와 trace가,
// fatal과 error가 합쳐져 대시보드가 구분하지 못한다. 레벨 이름을 그대로 보낸다.
test("와이어 레벨은 실제 이름을 그대로 보낸다 (접지 않는다)", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  for (const [i, lv] of [10, 20, 30, 40, 50, 60].entries()) lm.record({ level: lv, time: i, msg: "m" });
  assert.deepEqual(
    lm.buffer.map((e) => e.level),
    ["trace", "debug", "info", "warn", "error", "fatal"],
  );
});

test("터미널 하한은 파일, 대시보드에 영향을 주지 않는다", () => {
  const printed: number[] = [];
  const lm = new LogSink({ intercept: false, terminal: (rec) => printed.push(rec.level) });
  lm.setConsoleLevel("info");

  lm.record({ level: 20, time: 1, msg: "debug" });
  lm.record({ level: 30, time: 2, msg: "info" });

  assert.deepEqual(printed, [30], "터미널엔 info부터");
  assert.equal(lm.buffer.length, 2, "버퍼(=대시보드·파일 경로)는 둘 다 받는다");
});

test("링버퍼: maxLines 초과 시 오래된 것부터 폐기", () => {
  const lm = new LogSink({ intercept: false, maxLines: 3, terminal: quiet });
  for (let i = 0; i < 5; i++) lm.record({ level: 30, time: i, msg: `m${i}` });
  assert.equal(lm.buffer.length, 3);
  assert.deepEqual(
    lm.buffer.map((e) => e.text),
    ["m2", "m3", "m4"],
  );
});

// 관리자 로그 스트림도 연결 상한, 느린 소비자 처리를 둔다.
// 상한, 하트비트는 대시보드 SSE와 같은 설정을 쓴다.
function fakeRes({ writeResult = true, writableLength = 0 } = {}) {
  const res = {
    writes: [] as string[],
    writableLength,
    ended: false,
    destroyed: false,
    statusCode: null as number | null,
    body: null as unknown,
    handlers: {} as Record<string, () => void>,
    head: null as Record<string, string> | null,
    writeHead(_code: number, headers: Record<string, string>) {
      res.head = headers;
    },
    flushHeaders() {},
    write(p: string) {
      res.writes.push(p);
      return writeResult;
    },
    end() {
      res.ended = true;
    },
    destroy() {
      res.destroyed = true;
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

test("관리자 SSE: Connection: close로 연다(끊을 때 그 소켓을 강제로 닫으므로 다시 쓰지 않게)", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const res = fakeRes();
  assert.equal(lm.addClient(res, "owner"), true);
  assert.equal(res.head?.Connection, "close");
});

test("관리자 SSE: 연결 상한은 사용자마다 센다(설정 이름대로). 넘으면 429. 무한정 받지 않는다", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const { maxPerUser } = config.dashboard.sse;

  for (let i = 0; i < maxPerUser; i++) lm.addClient(fakeRes(), "owner");
  assert.equal(lm.clients.size, maxPerUser);

  const over = fakeRes();
  assert.equal(lm.addClient(over, "owner"), false);
  assert.equal(over.statusCode, null, "부른 경로가 문제 응답(too-many-streams)을 쓴다");
  assert.equal(lm.clients.size, maxPerUser, "상한을 넘는 연결은 등록하지 않는다");

  const other = fakeRes();
  assert.equal(lm.addClient(other, "someone-else"), true, "다른 사용자는 따로 센다");
  assert.equal(lm.clients.size, maxPerUser + 1);
});

test("관리자 SSE: 쓰기가 잠깐 밀린 것으로는 끊지 않고, 밀린 양이 상한을 넘는(읽지 않는) 소비자만 끊는다", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });

  // 붙을 때 쌓인 줄을 한꺼번에 보내면 write가 false를 돌려준다. 그것만으로 끊으면 붙는 순간 로그가 나면 끊긴다
  const busy = fakeRes({ writeResult: false, writableLength: 100_000 });
  lm.addClient(busy, "owner");
  lm.record({ level: 30, time: 1, msg: "한 줄" });
  assert.equal(busy.ended, false);
  assert.equal(lm.clients.size, 1);

  const stuck = fakeRes({ writeResult: false, writableLength: 2 * 1024 * 1024 });
  lm.addClient(stuck, "owner");
  lm.record({ level: 30, time: 2, msg: "한 줄" });
  assert.equal(stuck.destroyed, true, "end로는 읽지 않는 소켓과 쌓인 바이트가 남으므로 강제로 닫는다(destroy)");
  assert.equal(lm.clients.size, 1, "정리까지 되어야 다음 기록에서 다시 만나지 않는다");
});

test("관리자 SSE: 붙는 중에 로그가 나도 끊기지 않는다(쌓아 둔 줄 전부를 보내는 중 한 줄, 진짜 HTTP)", async () => {
  const http = await import("node:http");
  const lm = new LogSink({ intercept: false, terminal: quiet });
  for (let i = 0; i < KEPT_LINES; i++) lm.record({ level: 30, time: i, msg: `줄 ${i} ` + "x".repeat(120) });
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

test("관리자 SSE: 줄마다 기동표.번호를 싣고, 재연결하면 마지막 번호 뒤만 보낸다. 다른 실행의 번호면(봇을 다시 시작) reset 뒤 전부", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
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

test("관리자 SSE: 이어 받을 줄이 쌓아 둔 줄 밖으로 밀려났으면 받지 못한 줄 수(gap)를 줄보다 먼저 보낸다. 처음 연결은 알리지 않는다", () => {
  const lm = new LogSink({ maxLines: 3, intercept: false, terminal: quiet });
  for (let i = 1; i <= 10; i++) lm.record({ level: 30, time: i, msg: `줄 ${i}` });
  const gapOf = (res: ReturnType<typeof fakeRes>) => res.writes.flatMap((w) => [...w.matchAll(/^event: gap\ndata: (.+)$/gm)].map((m) => JSON.parse(m[1]) as { missed: number }));
  const ids = (res: ReturnType<typeof fakeRes>) => res.writes.flatMap((w) => [...w.matchAll(/^id: \d+\.(\d+)$/gm)].map((m) => Number(m[1])));

  const resumed = fakeRes();
  lm.addClient(resumed, "owner", `${lm.boot}.4`);
  assert.deepEqual(gapOf(resumed), [{ missed: 3 }], "5, 6, 7번이 밀려났다");
  assert.ok(resumed.writes.findIndex((w) => w.startsWith("event: gap")) < resumed.writes.findIndex((w) => w.startsWith("id:")), "줄보다 먼저");
  assert.deepEqual(ids(resumed), [8, 9, 10]);

  const caughtUp = fakeRes();
  lm.addClient(caughtUp, "owner", `${lm.boot}.7`);
  assert.deepEqual(gapOf(caughtUp), [], "바로 다음 줄부터 남아 있으면 빠진 것이 없다");

  const restarted = fakeRes();
  lm.addClient(restarted, "owner", `${lm.boot - 1}.99`);
  assert.deepEqual(gapOf(restarted), [{ missed: 7 }], "다시 시작했으면 이 실행의 1번부터 센다");

  const fresh = fakeRes();
  lm.addClient(fresh, "owner");
  assert.deepEqual(gapOf(fresh), [], "처음 연결");
});

test("관리자 SSE: 연결이 닫히면 하트비트도 함께 제거한다", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });

  const res = fakeRes();
  lm.addClient(res, "owner");
  assert.equal(typeof res.handlers.close, "function");
  assert.equal(typeof res.handlers.error, "function");

  res.handlers.close();
  res.handlers.close(); // 두 번 와도 한 번만
  assert.equal(lm.clients.size, 0);
});

test("SSE 브로드캐스트: 등록된 클라이언트에 data 프레임 전송", () => {
  const lm = new LogSink({ intercept: false, terminal: quiet });
  const res = fakeRes();
  lm.clients.add(res);
  lm.record({ level: 50, time: 7, msg: "err" });
  assert.equal(res.writes.length, 1);
  assert.equal(res.writes[0].split("\n")[0], `id: ${lm.boot}.1`);
  const parsed = JSON.parse(res.writes[0].split("data: ")[1]);
  assert.deepEqual(parsed, { id: 1, ts: 7, level: "error", text: "err" });
});

test("지난 1시간 경고, 오류는 줄 버퍼와 따로 둔다(fatal은 오류)", () => {
  const m = new LogSink({ intercept: false, maxLines: 2, terminal: () => {} });
  const at = Date.now();
  m.record({ level: 40, time: at - 2 * 60 * 60_000, msg: "두 시간 전" });
  m.record({ level: 40, time: at - 1000, msg: "경고" });
  m.record({ level: 60, time: at - 500, msg: "치명" });
  for (let i = 0; i < 5; i++) m.record({ level: 30, time: at, msg: `info ${i}` });
  assert.equal(m.buffer.length, 2, "줄 버퍼는 넘쳤다");
  assert.deepEqual(
    m.recentProblems(at).map((one) => [one.level, one.text]),
    [
      ["warn", "경고"],
      ["error", "치명"],
    ],
  );
});

// 하트비트는 연결 모두에 타이머 하나. 간격을 바꿔 저장하면 조립이 syncHeartbeat를 불러 다시 건다
test("관리자 SSE: 하트비트는 바뀐 간격으로 다시 건다", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const sse = config.dashboard.sse;
  const before = sse.heartbeatMs;
  const lm = new LogSink({ intercept: false, terminal: quiet });
  try {
    sse.heartbeatMs = 20_000;
    const res = fakeRes();
    lm.addClient(res, "owner");
    const pings = () => res.writes.filter((w) => w.startsWith(": ping")).length;
    mock.timers.tick(20_000);
    assert.equal(pings(), 1);

    sse.heartbeatMs = 5_000;
    lm.syncHeartbeat();
    mock.timers.tick(5_000);
    assert.equal(pings(), 2, "새 간격");
  } finally {
    sse.heartbeatMs = before;
    if (lm._heartbeat) clearInterval(lm._heartbeat);
    mock.timers.reset();
  }
});

// ── sink: destination이 예외를 던지면 로거가 아니라 notice로 알린다(로거로 알리면 record로 되돌아온다) ─────
test("destination이 예외를 던지면 처음 한 번과 풀릴 때 notice로 한 줄씩, 다른 destination은 계속 받는다", () => {
  const notes: string[] = [];
  const m = new LogSink({ intercept: false, terminal: quiet, notice: (line: string) => notes.push(line) });
  const got: LogRecord[] = [];
  let broken = true;
  m.addDestination(() => {
    if (broken) throw new Error("디스크 가득 참");
  });
  m.addDestination((rec) => got.push(rec));
  const at = (msg: string) => m.record({ level: LEVELS.info, time: Date.now(), msg });
  at("하나");
  at("둘");
  broken = false;
  at("셋");
  assert.equal(got.length, 3);
  assert.deepEqual(notes, ["[log] 로그 출력 대상 기록 실패: 디스크 가득 참 (해당 로그 유실)\n", "[log] 로그 출력 대상 기록 복구(실패 2회)\n"]);
});

test("기동 초기 레코드를 재생하다 예외를 던지면 끝난 뒤 실패 수와 첫 오류를 notice로 한 줄", () => {
  const notes: string[] = [];
  const m = new LogSink({ intercept: false, terminal: quiet, notice: (line: string) => notes.push(line) });
  for (const msg of ["a", "b", "c"]) m.record({ level: LEVELS.info, time: Date.now(), msg });
  m.addDestination((rec) => {
    if (rec.msg !== "b") throw new Error("열 수 없음");
  });
  assert.deepEqual(notes, ["[log] 기동 초기 버퍼 로그 기록 실패(실패 건 파일에서 누락): 2/3건 | 열 수 없음\n"]);
});
