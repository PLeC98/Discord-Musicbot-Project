// dashboard/src/utils/condition-range.ts: 상태 문구 조건의 범위를 저장 형식과 오가고, 입력란 글을 만든다

import { test } from "node:test";
import assert from "node:assert/strict";
import { daysIn, formatRange, parseRange, rangeText, wraps } from "../../../dashboard/src/utils/condition-range.ts";
import { statusProblems } from "../../../src/config/schema/status.ts";

test("저장 형식을 읽고 같은 글로 다시 쓴다. 못 읽으면 null", () => {
  for (const [kind, value] of [
    ["date", "12-24 ~ 12-26"],
    ["lunar", "01-01 ~ 01-15"],
    ["time", "22:00 ~ 06:00"],
    ["date", "12-28 ~ 01-05"],
  ] as const) {
    const range = parseRange(kind, value);
    assert.ok(range, value);
    assert.equal(formatRange(kind, range), value);
  }
  assert.deepEqual(parseRange("date", "12-24 ~ 12-26"), { start: [11, 23], end: [11, 25] }, "월, 일은 0 부터");
  for (const bad of ["", "12-24", "12-24 ~", "1-2 ~ 1-3", "22:00 ~ 06:00"]) assert.equal(parseRange("date", bad), null, bad);
  assert.equal(parseRange("time", "12-24 ~ 12-26"), null);
});

test("고르개가 만든 값은 저장 검사(schema/status)를 지난다", () => {
  const special = {
    양력: { date: formatRange("date", { start: [1, 28], end: [0, 0] }), messages: ["a"] },
    음력: { lunar: formatRange("lunar", { start: [0, 29], end: [0, 29] }), messages: ["a"] },
    시간: { time: formatRange("time", { start: [23, 59], end: [0, 0] }), messages: ["a"] },
  };
  assert.deepEqual(statusProblems({ interval: 60, messages: ["a"], special }), []);
});

test("끝이 시작보다 앞이면 넘긴다(같으면 아니다)", () => {
  assert.equal(wraps({ start: [11, 27], end: [0, 4] }), true);
  assert.equal(wraps({ start: [22, 0], end: [6, 0] }), true);
  assert.equal(wraps({ start: [3, 10], end: [3, 9] }), true);
  assert.equal(wraps({ start: [3, 10], end: [3, 10] }), false);
  assert.equal(wraps({ start: [0, 0], end: [11, 30] }), false);
});

test("입력란 글: 월일, 하루, 다음 해, 다음 날", () => {
  assert.equal(rangeText("date", { start: [11, 23], end: [11, 25] }), "12월 24일 ~ 12월 26일");
  assert.equal(rangeText("lunar", { start: [0, 0], end: [0, 0] }), "1월 1일 하루");
  assert.equal(rangeText("date", { start: [11, 27], end: [0, 4] }), "12월 28일 ~ 다음 해 1월 5일");
  assert.equal(rangeText("time", { start: [22, 0], end: [6, 0] }), "22:00 ~ 다음 날 06:00");
  assert.equal(rangeText("time", { start: [9, 5], end: [9, 5] }), "09:05 ~ 09:05", "시간대는 하루라고 하지 않는다");
});

test("달마다 날 수: 양력은 2월이 29일(연도가 없다), 음력은 30일", () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, m) => daysIn("date", m)),
    [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  );
  assert.equal(daysIn("lunar", 1), 30);
});
