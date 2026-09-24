// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { markTransient, isTransient } from "../../src/ui/transientMessages.ts";

test("스스로 지워질 메시지: 지울 시각(+여유)까지만 기억하고, 다시 표시하면 기한이 늘어난다", () => {
  const t0 = 1_000_000;
  markTransient("m1", 30000, t0);
  assert.equal(isTransient("m1", t0 + 30000), true);
  assert.equal(isTransient("m1", t0 + 60000), false, "기한이 지나면 보통 메시지로 센다");

  markTransient("m2", 30000, t0);
  markTransient("m2", 30000, t0 + 25000);
  assert.equal(isTransient("m2", t0 + 50000), true, "이어 넣어 수명이 다시 시작됐다");
  assert.equal(isTransient("unknown", t0), false);
});
