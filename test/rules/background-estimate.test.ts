// src/rules/background-estimate.ts — 로그인 배경 편집의 예상 저장 공간(편집 창 · 편집 적용이 같이 쓴다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { cropKeyOf, estimatedBytes, inCounted } from "../../src/rules/background-estimate.ts";

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const estimate = { perSecond: [100, 200, 300, 400], stillBytes: 50, crop: FULL, counted: null };

test("영상은 구간의 초마다 크기를 더한다(걸친 초는 걸친 만큼). 그림은 정지 그림 세트", () => {
  assert.equal(estimatedBytes(estimate, cropKeyOf(FULL), [0, 2]), 300);
  assert.equal(estimatedBytes(estimate, cropKeyOf(FULL), [0.5, 2.5]), 50 + 200 + 150);
  assert.equal(estimatedBytes(estimate, cropKeyOf(FULL), null), 50);
});

test("어림이 없거나 · 세는 중이거나 · 다른 크롭 · 잰 범위 밖이면 null", () => {
  assert.equal(estimatedBytes(null, cropKeyOf(FULL), [0, 2]), null);
  assert.equal(estimatedBytes({ ...estimate, counting: true }, cropKeyOf(FULL), [0, 2]), null);
  assert.equal(estimatedBytes(estimate, cropKeyOf({ x: 0, y: 0, w: 0.5, h: 1 }), [0, 2]), null);
  assert.equal(estimatedBytes({ ...estimate, counted: [1, 3] }, cropKeyOf(FULL), [0, 2]), null);
  assert.equal(estimatedBytes({ ...estimate, counted: [1, 3] }, cropKeyOf(FULL), [1.2, 3.4]), Math.round(0.8 * 200 + 300 + 0.4 * 400));
});

test("잰 구간 안: 처음 어림(전체)은 늘 안, 끝은 0.5초까지 봐준다", () => {
  assert.equal(inCounted(null, [5, 50]), true);
  assert.equal(inCounted([10, 20], [9.6, 20.4]), true);
  assert.equal(inCounted([10, 20], [9, 20]), false);
});
