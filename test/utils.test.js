"use strict";

// src/utils.js — 공용 소형 유틸

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatDuration } = require("../src/utils");

test("formatDuration: 초 → M:SS / H:MM:SS", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(null), "0:00");
  assert.equal(formatDuration(undefined), "0:00");
  assert.equal(formatDuration(1), "0:01");
  assert.equal(formatDuration(59), "0:59");
  assert.equal(formatDuration(60), "1:00");
  assert.equal(formatDuration(61), "1:01");
  assert.equal(formatDuration(599), "9:59");
  assert.equal(formatDuration(600), "10:00");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(3661), "1:01:01");
  assert.equal(formatDuration(7325), "2:02:05");
});

test("formatDuration: 소수/문자열 입력도 안전", () => {
  assert.equal(formatDuration(61.9), "1:01", "소수는 내림");
  assert.equal(formatDuration("185"), "3:05", "숫자 문자열 허용");
  assert.equal(formatDuration("abc"), "0:00", "비숫자는 0 취급");
});
