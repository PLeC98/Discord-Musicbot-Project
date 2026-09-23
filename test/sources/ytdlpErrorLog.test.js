"use strict";

// src/YouTube.js briefError — yt-dlp 오류를 로그에 남길 만큼으로 줄이는 계약.
// 회귀 대상: yt-dlp 내부 재시도가 같은 경고를 stderr에 다시 써서 한 번 실패에 같은 줄이
// 대여섯 개씩 쌓이던 것.

process.env.COOKIES_FROM_BROWSER = "";
process.env.COOKIES_FILE = "";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const YouTube = require("../../src/sources/youtube/index");

const COOKIE_WARN = "WARNING: [youtube] The provided YouTube account cookies are no longer valid.";
const AGE_ERROR = "ERROR: [youtube] EahYs-8tTjQ: Sign in to confirm your age.";

test("같은 줄이 반복되면 한 줄로 접는다", () => {
  const stderr = [COOKIE_WARN, COOKIE_WARN, COOKIE_WARN, COOKIE_WARN, COOKIE_WARN, AGE_ERROR].join("\n");
  assert.equal(YouTube.briefError(new Error(stderr)), `${COOKIE_WARN}\n${AGE_ERROR}`);
});

test("원인이 적힌 WARNING을 버리지 않는다", () => {
  // 쿠키가 무효라는 사실은 WARNING에만 있고 ERROR에는 연령 확인 요구만 적힌다.
  // ERROR만 남기면 왜 실패했는지를 잃는다.
  const out = YouTube.briefError(new Error(`${COOKIE_WARN}\n${AGE_ERROR}`));
  assert.ok(out.includes("no longer valid"));
  assert.ok(out.includes("Sign in to confirm your age"));
});

test("줄이 너무 많으면 잘라내고 몇 줄이 남았는지 밝힌다", () => {
  const stderr = ["하나", "둘", "셋", "넷", "다섯", "여섯"].join("\n");
  assert.equal(YouTube.briefError(new Error(stderr)), "하나\n둘\n셋\n넷\n(외 2줄)");
});

test("stderr가 있으면 그쪽을 본다", () => {
  const error = Object.assign(new Error("Command failed"), { stderr: AGE_ERROR });
  assert.equal(YouTube.briefError(error), AGE_ERROR);
});

test("한 줄짜리 평범한 오류는 그대로 지나간다", () => {
  assert.equal(YouTube.briefError(new Error("ENOENT: no such file")), "ENOENT: no such file");
});

test("빈 줄과 앞뒤 공백을 정리한다", () => {
  assert.equal(YouTube.briefError(new Error("  첫 줄  \n\n\n  둘째 줄")), "첫 줄\n둘째 줄");
});

test("오류가 아닌 값도 삼키지 않는다", () => {
  assert.equal(YouTube.briefError(null), "");
  assert.equal(YouTube.briefError("문자열 오류"), "문자열 오류");
});
