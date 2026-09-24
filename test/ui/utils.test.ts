// src/ui/format.ts — 공용 소형 유틸

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../../src/ui/format.ts";

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
