// src/infra/keyed-serial.ts: 키마다 차례로 돌리기. 셋 이상이 와도 하나씩, 앞 작업 실패의 격리, 자기 것만 정리, 줄마다 따로

import { test } from "node:test";
import assert from "node:assert/strict";
import { keyedSerial } from "../../src/infra/keyed-serial.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => ((resolve = ok), (reject = fail)));
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("같은 키의 작업은 셋 이상이 와도 하나씩 차례로 돈다(앞 작업이 끝나면 다음 하나만)", async () => {
  const serial = keyedSerial();
  const gates = [deferred(), deferred(), deferred()];
  const events: string[] = [];
  let active = 0;
  let most = 0;
  const job = (i: number) => async () => {
    active++;
    most = Math.max(most, active);
    events.push(`start:${i}`);
    await gates[i].promise;
    events.push(`end:${i}`);
    active--;
    return i;
  };
  const runs = [0, 1, 2].map((i) => serial.run("g", job(i)));
  await tick();
  assert.deepEqual(events, ["start:0"]);
  gates[0].resolve();
  await runs[0];
  await tick();
  assert.deepEqual(events, ["start:0", "end:0", "start:1"], "앞 작업이 끝나도 다음 하나만 시작한다");
  gates[1].resolve();
  gates[2].resolve();
  assert.deepEqual(await Promise.all(runs), [0, 1, 2]);
  assert.equal(most, 1);
});

test("다른 키는 서로 기다리지 않는다", async () => {
  const serial = keyedSerial();
  const gate = deferred();
  const a = serial.run("a", () => gate.promise);
  assert.equal(await serial.run("b", async () => "b"), "b");
  gate.resolve();
  await a;
});

test("앞 작업이 실패하면 그 호출자만 받고, 뒤 작업은 돈다", async () => {
  const serial = keyedSerial();
  const first = serial.run("g", async () => {
    throw new Error("앞 작업 실패");
  });
  const second = serial.run("g", async () => "뒤 작업");
  await assert.rejects(first, /앞 작업 실패/);
  assert.equal(await second, "뒤 작업");
});

test("끝난 키는 지운다. 앞 작업이 끝날 때 뒤 작업의 꼬리를 지우지 않는다", async () => {
  const serial = keyedSerial();
  const gate = deferred();
  const first = serial.run("g", async () => "앞");
  const second = serial.run("g", () => gate.promise);
  await first;
  assert.equal(serial.size, 1, "뒤 작업이 아직 돌고 있다");
  const third = serial.run("g", async () => "셋째");
  await tick();
  gate.resolve();
  await second;
  assert.equal(await third, "셋째");
  assert.equal(serial.size, 0);
});

test("줄마다 따로다. 한 줄의 작업 안에서 다른 줄의 같은 키를 불러도 기다리지 않는다", async () => {
  const outer = keyedSerial();
  const inner = keyedSerial();
  const got = await outer.run("g", () => inner.run("g", async () => "안"));
  assert.equal(got, "안");
});
