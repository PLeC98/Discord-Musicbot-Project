// src/rules/water-level.ts: 긴 것들만 같은 수위까지 줄여 정한 양을 덜어 내는 계산

import { test } from "node:test";
import assert from "node:assert/strict";
import { waterLevel } from "../../src/rules/water-level.ts";

test("필요한 양을 채우는 가장 높은 수위. 수위보다 짧은 것은 줄이지 않는다", () => {
  // 수위 40: 100 -> 40, 60 -> 40으로 80을 줄이고 10, 30은 그대로
  assert.equal(waterLevel([100, 10, 60, 30], 80), 40);
  // 한 칸 더 줄여야 하면 수위가 한 칸 내려간다(가장 긴 하나만 줄이지 않는다)
  assert.equal(waterLevel([100, 10, 60, 30], 81), 39);
});

test("줄일 것이 없으면 가장 긴 길이, 다 줄여도 모자라면 0", () => {
  assert.equal(waterLevel([5, 9], 0), 9);
  assert.equal(waterLevel([5, 9], 14), 0);
  assert.equal(waterLevel([5, 9], 99), 0);
  assert.equal(waterLevel([], 10), 0);
});
