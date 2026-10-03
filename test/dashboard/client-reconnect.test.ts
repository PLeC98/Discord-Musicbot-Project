// dashboard/src/utils/reconnect.js — 닫힌 실시간 연결을 다시 열기까지의 간격

import { test } from "node:test";
import assert from "node:assert/strict";
import { reopenDelay } from "../../dashboard/src/utils/reconnect.js";

test("닫힐 때마다 2 · 5 · 15 · 30 · 60초로 늘리고 그 뒤로는 60초", () => {
  const middle = () => 0.5; // 흔들지 않은 값
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 20].map((n) => reopenDelay(n, middle)),
    [2000, 5000, 15000, 30000, 60000, 60000, 60000],
  );
});

test("여러 탭이 같은 때에 붙지 않게 ±20% 안에서 흔든다", () => {
  assert.equal(
    reopenDelay(0, () => 0),
    1600,
  );
  assert.equal(
    reopenDelay(0, () => 0.999999),
    2400,
  );
});
