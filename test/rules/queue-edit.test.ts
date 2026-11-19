// src/rules/queue-edit.ts: /queue 편집 화면의 곡 옮기기(대기열 ID로 누른 때의 자리에서 셈한다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedAt, isEditAction, movePlan } from "../../src/rules/queue-edit.ts";

const ENTRIES = [11, 12, 13, 14];

test("다음에 재생은 맨 앞 곡 앞에, 위로는 바로 앞 곡 앞에, 아래로는 두 칸 뒤 곡 앞에(끝에서 둘째면 맨 끝)", () => {
  assert.deepEqual(movePlan(ENTRIES, 13, "next"), { before: 11 });
  assert.deepEqual(movePlan(ENTRIES, 13, "up"), { before: 12 });
  assert.deepEqual(movePlan(ENTRIES, 12, "down"), { before: 14 });
  assert.deepEqual(movePlan(ENTRIES, 13, "down"), { before: null });
});

test("이미 그 자리면 stay, 대기열에 없으면 gone(화면을 그린 뒤 바뀐 대기열)", () => {
  assert.equal(movePlan(ENTRIES, 11, "next"), "stay");
  assert.equal(movePlan(ENTRIES, 11, "up"), "stay");
  assert.equal(movePlan(ENTRIES, 14, "down"), "stay");
  assert.equal(movePlan([11], 11, "down"), "stay");
  assert.equal(movePlan(ENTRIES, 99, "up"), "gone");
});

test("끄는 버튼: 맨 앞은 다음에 재생과 위로, 맨 끝은 아래로, 한 곡이면 셋 다", () => {
  assert.deepEqual([...blockedAt(0, 4)].sort(), ["next", "up"]);
  assert.deepEqual([...blockedAt(3, 4)], ["down"]);
  assert.deepEqual([...blockedAt(1, 4)], []);
  assert.deepEqual([...blockedAt(0, 1)].sort(), ["down", "next", "up"]);
});

test("동작 이름", () => {
  assert.ok(["play", "next", "up", "down", "remove"].every(isEditAction));
  assert.ok(!isEditAction("clear") && !isEditAction(""));
});
