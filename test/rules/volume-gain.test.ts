// src/rules/volume-gain.ts: 볼륨(0 ~ 125)을 PCM 볼륨 게인으로 바꾼다(한 칸 0.4 dB, 100 이 0 dB)

import { test } from "node:test";
import assert from "node:assert/strict";
import { gainOf } from "../../src/rules/volume-gain.ts";

const db = (gain: number) => 20 * Math.log10(gain);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("100 은 0 dB, 0 은 음소거, 그 사이는 한 칸마다 0.4 dB", () => {
  assert.equal(gainOf(100), 1);
  assert.equal(gainOf(0), 0);
  assert.ok(near(db(gainOf(1)), -39.6));
  assert.ok(near(db(gainOf(50)), -20));
  assert.ok(near(db(gainOf(75)), -10));
  for (let v = 1; v < 125; v++) assert.ok(near(db(gainOf(v + 1)) - db(gainOf(v)), 0.4), `${v} → ${v + 1}`);
});

test("100 위는 증폭이고 125 가 +10 dB", () => {
  assert.ok(near(db(gainOf(110)), 4));
  assert.ok(near(db(gainOf(125)), 10));
});

test("범위 밖은 0 ~ 125 로 자른다(세션 복원이 범위 밖 값을 줄 수 있다)", () => {
  assert.equal(gainOf(150), gainOf(125));
  assert.equal(gainOf(-5), 0);
});
