// src/infra/log/file.js — NDJSON 파일 destination (원본 보존 / ANSI 제거 / 크기 회전 / 실패 시 조용히 중단)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import fileModule from "../../src/infra/log/file.js";
const { createFileDestination, backupPath, nextBackupPath, stripAnsi, stamp } = fileModule;

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "logfile-test-"));
}

const rec = (msg, extra = {}) => ({ time: 1757400000000, level: 30, msg, ...extra });
const lines = (file) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test("한 줄에 레코드 하나, 바인딩을 그대로 보존한다", () => {
  const file = path.join(tmpdir(), "bot.log");
  const dest = createFileDestination({ file, maxBytes: 1e9, keep: 3 });
  dest.write(rec("첫 줄", { category: "player", sub: "play", tags: ["retry"] }));
  dest.write(rec("둘째 줄", { category: "watchdog" }));
  dest.close();

  const out = lines(file);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { time: 1757400000000, level: 30, msg: "첫 줄", category: "player", sub: "play", tags: ["retry"] });
  assert.equal(out[1].category, "watchdog");
});

test("ANSI만 벗긴다 — 색이 남으면 grep이 깨진다", () => {
  const file = path.join(tmpdir(), "bot.log");
  const dest = createFileDestination({ file, maxBytes: 1e9, keep: 3 });
  dest.write(rec("\u001b[31m❌ 실패\u001b[39m"));
  dest.close();

  assert.equal(lines(file)[0].msg, "❌ 실패");
});

test("이어 쓰기 — 재시작해도 기존 내용을 덮지 않는다", () => {
  const file = path.join(tmpdir(), "bot.log");
  const first = createFileDestination({ file, maxBytes: 1e9, keep: 3 });
  first.write(rec("이전 기동"));
  first.close();

  const second = createFileDestination({ file, maxBytes: 1e9, keep: 3 });
  second.write(rec("이번 기동"));
  second.close();

  assert.deepEqual(
    lines(file).map((l) => l.msg),
    ["이전 기동", "이번 기동"],
  );
});

// 분리된 파일에는 번호가 아니라 분리한 시각이 붙는다 (bot-2026-09-10T14-23-05.123.log).
// 번호 방식은 회전마다 파일 전부를 rename해야 하고, 번호의 뜻이 회전할 때마다 바뀐다.
// 이름순 정렬이 곧 시간순이라는 것이 이 방식의 계약이다.
const rotated = (dir) =>
  fs
    .readdirSync(dir)
    .filter((n) => /^bot-\d{4}-\d{2}-\d{2}T/.test(n))
    .sort();

test("크기를 넘으면 분리하고, keep 개수만 남긴다", () => {
  const dir = tmpdir();
  const file = path.join(dir, "bot.log");
  const dest = createFileDestination({ file, maxBytes: 120, keep: 2 });
  for (let i = 0; i < 5; i++) dest.write(rec(`줄 ${i} ${"x".repeat(100)}`));
  dest.close();

  assert.equal(rotated(dir).length, 2, "keep을 넘는 것은 오래된 것부터 지운다");
});

test("분리된 파일 이름은 시간순으로 정렬된다", () => {
  const dir = tmpdir();
  const file = path.join(dir, "bot.log");
  const dest = createFileDestination({ file, maxBytes: 120, keep: 0 });
  for (let i = 0; i < 4; i++) dest.write(rec(`줄 ${i} ${"x".repeat(100)}`));
  dest.close();

  const names = rotated(dir);
  assert.ok(names.length >= 3, `분리본이 쌓여야 한다 (${names.join(", ")})`);
  // 이름순 = 시간순이면, 첫 파일이 가장 먼저 쓴 줄을 담고 있어야 한다.
  assert.match(lines(path.join(dir, names[0]))[0].msg, /줄 0/);
  assert.deepEqual(names, [...names].sort(), "이름순이 곧 시간순");
});

test("분리 후에도 최신 줄은 bot.log에 있다", () => {
  const dir = tmpdir();
  const file = path.join(dir, "bot.log");
  const dest = createFileDestination({ file, maxBytes: 200, keep: 2 });
  dest.write(rec(`오래된 ${"x".repeat(150)}`)); // 여기서 분리
  dest.write(rec("최신"));
  dest.close();

  assert.match(lines(file).at(-1).msg, /최신/);
});

test("maxBytes=0이면 분리하지 않고 한 파일에 계속 쓴다", () => {
  const dir = tmpdir();
  const file = path.join(dir, "bot.log");
  const dest = createFileDestination({ file, maxBytes: 0, keep: 5 });
  for (let i = 0; i < 5; i++) dest.write(rec(`줄 ${i} ${"x".repeat(40)}`));
  dest.close();

  assert.equal(lines(file).length, 5);
  assert.equal(rotated(dir).length, 0, "분리본이 생기면 안 된다");
});

test("keep=0이면 분리는 하되 오래된 것을 지우지 않는다", () => {
  const dir = tmpdir();
  const file = path.join(dir, "bot.log");
  const dest = createFileDestination({ file, maxBytes: 50, keep: 0 });
  for (let i = 0; i < 5; i++) dest.write(rec(`줄 ${i} ${"x".repeat(40)}`));
  dest.close();

  assert.ok(rotated(dir).length >= 4, "제한이 없으므로 계속 쌓인다");
});

test("직렬화 불가(순환 참조)여도 던지지 않고 메시지는 남긴다", () => {
  const file = path.join(tmpdir(), "bot.log");
  const dest = createFileDestination({ file, maxBytes: 1e9, keep: 3 });
  const circular = {};
  circular.self = circular;
  dest.write(rec("순환 포함", { ctx: circular }));
  dest.close();

  assert.equal(lines(file)[0].msg, "순환 포함");
});

test("파일을 못 열면 던지지 않고 조용히 중단한다 (로깅이 봇을 멈추지 않는다)", () => {
  const blocker = path.join(tmpdir(), "blocked");
  fs.writeFileSync(blocker, "이건 파일이라 디렉터리로 못 만든다");
  const realWrite = process.stderr.write;
  process.stderr.write = () => true; // 안내 한 줄이 테스트 출력을 더럽히지 않게
  try {
    const dest = createFileDestination({ file: path.join(blocker, "bot.log"), maxBytes: 1e9, keep: 3 });
    dest.write(rec("아무 데도 안 감"));
    dest.close();
  } finally {
    process.stderr.write = realWrite;
  }
});

test("backupPath: 확장자 앞에 시각을 넣고, 확장자가 없으면 뒤에 붙인다", () => {
  const at = new Date(2026, 8, 10, 14, 23, 5, 123); // 월은 0부터 — 9월
  assert.equal(backupPath("/a/bot.log", at), "/a/bot-2026-09-10T14-23-05.123.log");
  assert.equal(backupPath("/a/bot", at), "/a/bot-2026-09-10T14-23-05.123");
});

// 회귀: 같은 밀리초에 두 번 회전할 때 번호를 덧붙이면(`…407-2.log`) `-`가 `.`보다 작아
// 번호 붙은 쪽이 원본보다 앞으로 정렬됐다. 빠른 러너에서만 드러나던 실패다(2026-09-15 CI).
test("이름이 겹치면 시각을 밀어서 비운다 — 이름순이 곧 시간순이어야 한다", () => {
  const at = new Date(2026, 8, 10, 14, 23, 5, 123);
  const taken = new Set(["/a/bot-2026-09-10T14-23-05.123.log", "/a/bot-2026-09-10T14-23-05.124.log"]);

  const first = nextBackupPath("/a/bot.log", (p) => taken.has(p), at);
  assert.equal(first, "/a/bot-2026-09-10T14-23-05.125.log");
  assert.deepEqual([...taken, first].sort(), [...taken].sort().concat(first), "나중 것이 이름순으로도 뒤");
  assert.equal(
    nextBackupPath("/a/bot.log", () => false, at),
    backupPath("/a/bot.log", at),
    "안 겹치면 그대로",
  );
});

test("stamp: 파일명에 못 쓰는 `:`를 쓰지 않는다", () => {
  assert.equal(stamp(new Date(2026, 0, 2, 3, 4, 5, 6)), "2026-01-02T03-04-05.006");
});

test("stripAnsi: 문자열이 아니면 그대로 통과", () => {
  assert.equal(stripAnsi(42), 42);
  assert.equal(stripAnsi(undefined), undefined);
});
