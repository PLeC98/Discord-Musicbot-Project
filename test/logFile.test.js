"use strict";

// src/logFile.js — NDJSON 파일 destination (원본 보존 / ANSI 제거 / 크기 회전 / 실패 시 조용히 중단)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFileDestination, backupPath, stripAnsi } = require("../src/logFile");

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

test("크기를 넘으면 회전하고, keep 개수만 남긴다", () => {
  const file = path.join(tmpdir(), "bot.log");
  const dest = createFileDestination({ file, maxBytes: 120, keep: 2 });
  for (let i = 0; i < 12; i++) dest.write(rec(`줄 ${i} ${"x".repeat(50)}`));
  dest.close();

  assert.ok(fs.existsSync(file), "현재 파일은 항상 bot.log");
  assert.ok(fs.existsSync(backupPath(file, 1)));
  assert.ok(fs.existsSync(backupPath(file, 2)));
  assert.equal(fs.existsSync(backupPath(file, 3)), false, "keep을 넘는 회전본은 남기지 않는다");
});

test("회전 후에도 최신 줄은 bot.log에 있다", () => {
  const file = path.join(tmpdir(), "bot.log");
  const dest = createFileDestination({ file, maxBytes: 100, keep: 2 });
  dest.write(rec(`오래된 ${"x".repeat(60)}`)); // 여기서 회전
  dest.write(rec("가장 최근"));
  dest.close();

  assert.equal(lines(file).at(-1).msg, "가장 최근");
});

test("keep=0이면 회전하지 않는다 (무한 증가는 사용자 선택)", () => {
  const file = path.join(tmpdir(), "bot.log");
  const dest = createFileDestination({ file, maxBytes: 50, keep: 0 });
  for (let i = 0; i < 5; i++) dest.write(rec(`줄 ${i} ${"x".repeat(40)}`));
  dest.close();

  assert.equal(lines(file).length, 5);
  assert.equal(fs.existsSync(backupPath(file, 1)), false);
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

test("backupPath: 확장자 유지, 없으면 뒤에 붙임", () => {
  assert.equal(backupPath("/a/bot.log", 3), "/a/bot.3.log");
  assert.equal(backupPath("/a/bot", 3), "/a/bot.3");
});

test("stripAnsi: 문자열이 아니면 그대로 통과", () => {
  assert.equal(stripAnsi(42), 42);
  assert.equal(stripAnsi(undefined), undefined);
});
