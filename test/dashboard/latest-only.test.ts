// src/dashboard/latest-only.ts: 사람마다 한 번에 하나, 마지막 것만

import { test } from "node:test";
import assert from "node:assert/strict";
import { latestOnly } from "../../src/dashboard/latest-only.ts";

// 손으로 끝내는 작업
function gate<T>(value: T) {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  const started: string[] = [];
  const work = (name: string) => async () => {
    started.push(name);
    await done;
    return value;
  };
  return { open, work, started };
}

test("앞 작업이 도는 동안 온 것 가운데 마지막 것만 한다. 사이에 온 것은 하지 않고 null", async () => {
  const run = latestOnly();
  const g = gate("결과");
  const first = run("u1", g.work("1"));
  const second = run("u1", g.work("2"));
  const third = run("u1", g.work("3"));
  g.open();
  assert.deepEqual(await Promise.all([first, second, third]), ["결과", null, "결과"]);
  assert.deepEqual(g.started, ["1", "3"], "2 는 시작하지 않는다");
});

test("도는 작업이 없으면 곧바로 시작하고, 사람마다 따로 줄 선다", async () => {
  const run = latestOnly();
  const g = gate(1);
  const a = run("u1", g.work("a"));
  const b = run("u2", g.work("b"));
  assert.deepEqual(g.started, ["a", "b"], "다른 사람은 기다리지 않는다");
  g.open();
  assert.deepEqual(await Promise.all([a, b]), [1, 1]);
});

test("앞 작업이 실패해도 다음 작업은 한다. 실패는 그 작업을 부른 쪽이 받는다", async () => {
  const run = latestOnly();
  const failed = run("u1", async () => {
    throw new Error("x");
  });
  const next = run("u1", async () => "다음");
  await assert.rejects(failed);
  assert.equal(await next, "다음");
});
