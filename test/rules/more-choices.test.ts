// src/rules/more-choices.ts — 더 넣기의 선택지와 적어 넣은 곡 수

import { test } from "node:test";
import assert from "node:assert/strict";
import { moreChoices, parseCount } from "../../src/rules/more-choices.ts";

test("선택지: 묶음 단위로, 남은 곡과 남은 자리 중 작은 쪽을 넘지 않는다", () => {
  assert.deepEqual(moreChoices({ remaining: 9896, room: 200, batch: 50 }), { cap: 200, steps: [50, 100] });
  assert.deepEqual(moreChoices({ remaining: 70, room: Infinity, batch: 50 }), { cap: 70, steps: [50] });
  assert.deepEqual(moreChoices({ remaining: 70, room: 0, batch: 50 }), { cap: 0, steps: [] });
});

test("선택지: 출처의 한 번 상한(perClick)도 넘지 않는다", () => {
  assert.deepEqual(moreChoices({ remaining: 70, room: Infinity, batch: 50, perClick: 10 }), { cap: 10, steps: [] });
});

test("곡 수 입력: 1 이상의 정수만", () => {
  assert.equal(parseCount(" 120 "), 120);
  for (const bad of ["0", "-5", "1.5", "abc", "", "123456"]) assert.equal(parseCount(bad), null, bad);
});
