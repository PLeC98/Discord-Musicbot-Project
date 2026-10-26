// src/rules/volume-gain.ts — 볼륨(0 ~ 100)을 PCM 배율로(세제곱)

import { test } from "node:test";
import assert from "node:assert/strict";
import { gainOf } from "../../src/rules/volume-gain.ts";

const db = (gain: number) => 20 * Math.log10(gain);

test("100 은 1, 0 은 0, 그 사이는 세제곱", () => {
  assert.equal(gainOf(100), 1);
  assert.equal(gainOf(0), 0);
  assert.equal(gainOf(50), 0.125);
  assert.ok(Math.abs(db(gainOf(50)) - -18.06) < 0.01);
  assert.ok(Math.abs(db(gainOf(25)) - -36.12) < 0.01);
});

test("범위 밖은 0 ~ 100 으로 자른다(세션 복원이 100 넘는 값을 줄 수 있다)", () => {
  assert.equal(gainOf(150), 1);
  assert.equal(gainOf(-5), 0);
});
