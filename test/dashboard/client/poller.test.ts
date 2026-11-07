// dashboard/src/composables/poller.ts: 끝날 때까지 주기적으로 조회한다. 실패하면 멈추지 않고 간격을 늘려 재시도하고, 성공하면 처음 간격으로 돌아간다. 멈추면 예약을 취소하고 늦게 온 응답을 버린다

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPoller } from "../../../dashboard/src/composables/poller.ts";

// 수동으로 돌리는 타이머. 예약된 간격을 기록하고 fire 로 하나씩 실행한다
function manualTimers() {
  const scheduled: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  return {
    scheduled,
    timers: {
      set: (run: () => void, ms: number) => {
        const one = { run, ms, cleared: false };
        scheduled.push(one);
        return one;
      },
      clear: (timer: unknown) => {
        if (timer) (timer as { cleared: boolean }).cleared = true;
      },
    },
    live: () => scheduled.filter((one) => !one.cleared),
    async fire() {
      const next = scheduled.find((one) => !one.cleared);
      assert.ok(next, "예약된 것이 있다");
      next.cleared = true;
      next.run();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("tick 이 true 면 같은 간격으로 다시 조회하고 false 면 멈춘다", async () => {
  const clock = manualTimers();
  const answers = [true, false];
  const poller = createPoller(async () => answers.shift()!, { intervalMs: 100, timers: clock.timers });
  poller.start();
  await clock.fire();
  assert.deepEqual(
    clock.live().map((one) => one.ms),
    [100],
  );
  await clock.fire();
  assert.deepEqual(clock.live(), [], "끝났으면 더 조회하지 않는다");
});

test("요청이 실패하면 멈추지 않고 간격을 두 배씩(상한까지) 늘려 재시도하고, 성공하면 처음 간격으로 돌아간다", async () => {
  const clock = manualTimers();
  const answers: Array<boolean | Error> = [new Error("1"), new Error("2"), new Error("3"), true];
  const poller = createPoller(
    async () => {
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    },
    { intervalMs: 100, maxIntervalMs: 300, timers: clock.timers },
  );
  poller.start();
  const waits: number[] = [];
  for (let i = 0; i < 4; i++) {
    await clock.fire();
    waits.push(clock.live()[0]?.ms);
  }
  assert.deepEqual(waits, [200, 300, 300, 100]);
});

test("멈추면 예약을 취소하고 진행 중인 요청을 취소한다(늦게 와도 다시 예약하지 않는다). 다시 시작하면 이전 요청을 취소하고 처음부터 시작한다", async () => {
  const clock = manualTimers();
  const pending: Array<{ signal: AbortSignal; answer: (again: boolean) => void }> = [];
  const poller = createPoller((signal) => new Promise<boolean>((resolve) => pending.push({ signal, answer: resolve })), { intervalMs: 100, timers: clock.timers });
  poller.start();
  await clock.fire();
  poller.stop();
  assert.equal(pending[0].signal.aborted, true);
  pending[0].answer(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(clock.live(), []);

  poller.start();
  await clock.fire();
  poller.start();
  assert.equal(pending[1].signal.aborted, true, "다시 시작하면 이전 요청을 취소한다");
  pending[1].answer(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    clock.live().map((one) => one.ms),
    [100],
    "취소된 요청의 응답은 다시 예약하지 않는다",
  );
});
