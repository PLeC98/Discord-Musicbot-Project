// src/rules/retry-budget.ts — 끊긴 곡을 다시 열지 넘길지

import { test } from "node:test";
import assert from "node:assert/strict";
import { countDrop, FRESH } from "../../src/rules/retry-budget.ts";

const GOING = 30_000; // 5초는 넘고 60초는 못 간 재생

// 같은 곡이 progress 들로 차례로 끊겼을 때 매번 다시 열었나
function run(progress: number[], live = false) {
  let state = FRESH;
  return progress.map((ms) => {
    const step = countDrop(state, ms, live);
    state = step.state;
    return step.reopen;
  });
}

test("곡마다 두 번 다시 연다. 세 번째 끊김이면 넘긴다", () => {
  assert.deepEqual(run([GOING, GOING, GOING]), [true, true, false]);
  assert.equal(countDrop({ used: 2, stalled: 0 }, GOING, false).why, "재시도 2회 소진");
});

test("한 재생이 60초를 가다 끊겼으면 예산을 다시 채운다", () => {
  assert.deepEqual(run([GOING, GOING, 60_000, GOING, GOING]), [true, true, true, true, false]);
  assert.deepEqual(run([GOING, GOING, 59_999]), [true, true, false]);
  assert.deepEqual(countDrop({ used: 2, stalled: 1 }, 60_000, false).state, { used: 1, stalled: 0 });
});

test("5초도 못 가고 연달아 두 번 끊기면 예산이 남아도 넘긴다. 5초를 가면 다시 센다", () => {
  assert.deepEqual(run([4_999, 4_999]), [true, false]);
  assert.equal(countDrop({ used: 1, stalled: 1 }, 1000, false).why, "5초도 못 가고 2번 연달아 끊김");
  assert.deepEqual(run([4_999, 5_000]), [true, true]);
  assert.deepEqual(countDrop({ used: 1, stalled: 1 }, 5_000, false).state, { used: 2, stalled: 0 });
});

test("라이브는 다섯 번 다시 연다. 진전 없음으로 넘기지 않고, 60초를 가면 다시 채운다", () => {
  assert.deepEqual(run([0, 0, 0, 0, 0, 0], true), [true, true, true, true, true, false]);
  assert.equal(countDrop({ used: 5, stalled: 5 }, 0, true).why, "재시도 5회 소진");
  assert.deepEqual(run([0, 0, 0, 0, 0, 60_000, 0], true), [true, true, true, true, true, true, true]);
});
