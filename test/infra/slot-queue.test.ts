// src/infra/slot-queue.ts — 동시에 도는 수를 묶는 줄. 상한까지만 자리를 주고 차례(rank · 온 차례)로, 끊기 · 닫기

import { test } from "node:test";
import assert from "node:assert/strict";
import { SlotQueue } from "../../src/infra/slot-queue.ts";

const tick = () => new Promise((done) => setImmediate(done));

test("상한까지만 자리를 주고 나머지는 자리가 나면 온 차례로", async () => {
  const queue = new SlotQueue(() => 2);
  const entered: number[] = [];
  const leaves: Array<() => void> = [];
  for (const n of [1, 2, 3, 4]) void queue.take().then((leave) => (entered.push(n), leaves.push(leave)));
  await tick();
  assert.deepEqual(entered, [1, 2]);
  assert.deepEqual(queue.stats(), { running: 2, size: 2, waiting: 2 });
  leaves[0]();
  leaves[0](); // 두 번 불러도 한 번만 센다
  await tick();
  assert.deepEqual(entered, [1, 2, 3]);
  assert.deepEqual(queue.stats(), { running: 2, size: 2, waiting: 1 });
});

test("기다리는 차례는 rank 가 작은 것부터, 같으면 온 차례로", async () => {
  const queue = new SlotQueue(() => 1);
  const hold = await queue.take();
  const entered: string[] = [];
  const order: Array<[string, number]> = [
    ["미리 받기 1", 2],
    ["지금 곡", 1],
    ["미리 받기 2", 2],
    ["다시 묻기", 0],
  ];
  for (const [name, rank] of order) void queue.take({ rank }).then((leave) => (entered.push(name), leave()));
  hold();
  await tick();
  await tick();
  assert.deepEqual(entered, ["다시 묻기", "지금 곡", "미리 받기 1", "미리 받기 2"]);
});

test("크기는 들일 때마다 다시 읽는다", async () => {
  let size = 1;
  const queue = new SlotQueue(() => size);
  const first = await queue.take();
  let second = false;
  void queue.take().then(() => (second = true));
  await tick();
  assert.equal(second, false);
  size = 2;
  void queue.take(); // 다음에 자리를 줄 때 늘어난 크기를 본다
  await tick();
  assert.equal(second, true);
  first();
});

test("기다리다 끊기면 줄에서 빠지고 그 까닭으로 거절된다. 이미 끊긴 신호는 곧바로", async () => {
  const queue = new SlotQueue(() => 1);
  const hold = await queue.take();
  const controller = new AbortController();
  const waiting = queue.take({ signal: controller.signal });
  controller.abort(new Error("그만"));
  await assert.rejects(waiting, /그만/);
  assert.equal(queue.stats().waiting, 0);
  await assert.rejects(queue.take({ signal: AbortSignal.abort(new Error("벌써")) }), /벌써/);
  hold();
  assert.equal(queue.stats().running, 0);
});

test("닫으면 기다리던 것과 새로 잡는 것을 거절한다. 도는 것은 그대로 끝난다", async () => {
  const queue = new SlotQueue(() => 1);
  const hold = await queue.take();
  const waiting = queue.take();
  queue.close(new Error("닫힘"));
  await assert.rejects(waiting, /닫힘/);
  await assert.rejects(queue.take(), /닫힘/);
  assert.deepEqual(queue.stats(), { running: 1, size: 1, waiting: 0 });
  hold();
  assert.equal(queue.stats().running, 0);
});
