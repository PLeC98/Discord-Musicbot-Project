// src/infra/log 전체: 문구(서술자)로 찍은 한 줄이 한 프로세스 안에서 터미널, 실시간 로그(SSE), 로그 파일, 로그 파일 보기까지 같은 글과 문구 코드로 간다.
// 로그 테스트 언어로 찍으면 네 출구 모두 바꾼 글이다(옮긴 줄이 문구표를 거치는지 보는 기준)

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LogRecord } from "../../src/infra/log/sink.ts";
import logger from "../../src/infra/log/logger.ts";
import sink from "../../src/infra/log/sink.ts";
import { createFileDestination } from "../../src/infra/log/file.ts";
import { L } from "../../src/infra/log/text.ts";
import { useTestLogLanguage } from "../../src/infra/log/language.ts";
import { readLogPage } from "../../src/dashboard/log-file-reader.ts";

const { createLogger } = logger._internals;
const { LogSink } = sink;

const dirs: string[] = [];
after(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});
afterEach(() => useTestLogLanguage(false));

/** SSE 응답 흉내: 쓴 프레임만 모은다 */
function fakeStream() {
  const frames: string[] = [];
  return {
    frames,
    res: { writableLength: 0, writeHead() {}, flushHeaders() {}, write: (chunk: string) => (frames.push(chunk), true), end() {}, destroy() {}, on() {} },
  };
}

/** 네 출구를 붙인 로거로 한 줄을 찍고, 출구마다 받은 것. record: 로거를 거치지 않고 sink에 바로 넣는다(서드파티 console 줄처럼 문구가 없는 줄) */
async function throughExits(write: (log: ReturnType<typeof createLogger>, record: (rec: LogRecord) => void) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-exits-"));
  dirs.push(dir);
  const file = path.join(dir, "bot.log");
  const terminal: LogRecord[] = [];
  const lm = new LogSink({ intercept: false, terminal: (rec) => terminal.push(rec) });
  const dest = createFileDestination({ file, maxBytes: 0, keep: 0 });
  lm.destinations.push(dest.write);
  const stream = fakeStream();
  lm.addClient(stream.res, "operator", { maxPerUser: 1, heartbeatMs: 60_000 });
  write(
    createLogger({ category: "config" }, null, (rec) => lm.record(rec)),
    (rec) => lm.record(rec),
  );
  dest.close();
  lm.drop(stream.res);
  const sse = stream.frames.filter((frame) => frame.startsWith("id:") || frame.includes("\ndata:") || frame.startsWith("data:")).map((frame) => JSON.parse(/data: (.*)/.exec(frame)![1]) as { text: string });
  const fileLines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const page = await readLogPage({ name: "bot.log", path: file }, { limit: 10, filter: {} });
  return { terminal, sse, fileLines, viewer: page!.lines, file };
}

test("문구 한 줄이 터미널, SSE, 파일, 로그 파일 보기에 같은 글로 가고, 파일에는 문구 코드와 값이 남는다", async () => {
  const text = L.config.logLanguageIgnored({ value: "zz", malformed: false, language: "ko" });
  const expected = "LOG_LANGUAGE 무시(zz): 그 언어의 로그 문구가 없음. 로그 언어: ko";
  const got = await throughExits((log) => log.warn(text));
  assert.equal(got.terminal[0].msg, expected);
  assert.equal(got.terminal[0].event, "config.logLanguageIgnored");
  assert.ok(
    got.sse.some((entry) => entry.text === expected),
    "실시간 로그",
  );
  assert.equal(got.fileLines[0].msg, expected);
  assert.equal(got.fileLines[0].event, "config.logLanguageIgnored");
  assert.deepEqual(got.fileLines[0].args, { value: "zz", malformed: false, language: "ko" });
  assert.equal(got.fileLines[0].category, "config");
  assert.equal(got.viewer[0].text, expected, "로그 파일 보기");
});

test("실시간 로그와 로그 파일 보기의 줄에 문구 코드가 실리고(값 안의 라벨 것까지), 문구 코드로 찾을 수 있다", async () => {
  const label = L.core.runRecordUpdate();
  const got = await throughExits((log, record) => {
    log.warn(L.failure.started({ what: label, reason: "x" }));
    record({ level: 30, time: Date.now(), msg: "문구 없는 줄" });
  });
  const sse = got.sse as Array<{ text: string; events?: string[] }>;
  assert.deepEqual(sse.find((entry) => entry.text.startsWith("실행 기록 갱신 실패"))?.events, ["failure.started", "core.runRecordUpdate"]);
  assert.equal(sse.find((entry) => entry.text === "문구 없는 줄")?.events, undefined, "문구로 찍지 않은 줄에는 없다");
  assert.deepEqual(got.viewer[0].events, ["failure.started", "core.runRecordUpdate"]);
  for (const q of ["failure.started", "runRecordUpdate"]) {
    const found = await readLogPage({ name: "bot.log", path: got.file }, { limit: 10, filter: { q } });
    assert.deepEqual(
      found!.lines.map((line) => line.text),
      ["실행 기록 갱신 실패: x"],
      q,
    );
  }
});

test("로그 테스트 언어로 찍으면 네 출구 모두 바꾼 글이다", async () => {
  useTestLogLanguage(true);
  const got = await throughExits((log) => log.warn(L.config.logLanguageIgnored({ value: "zz", malformed: true, language: "qps-ploc" })));
  const hangul = /[가-힣]/;
  assert.doesNotMatch(String(got.terminal[0].msg), hangul);
  assert.ok(got.sse.length > 0 && got.sse.every((entry) => !hangul.test(entry.text)));
  assert.doesNotMatch(String(got.fileLines[0].msg), hangul);
  assert.doesNotMatch(got.viewer[0].text, hangul);
  assert.equal(got.fileLines[0].event, "config.logLanguageIgnored", "문구 코드는 언어와 상관없다");
});
