// src/sources/ytdlp-spawn.ts: CPU 상한이 걸려 있으면 두 줄을 합쳐 동시에 도는 yt-dlp 수를 상한에 맞춰 제한한다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import run, { useExec, useLaneSizes, useCpuSlots, cpuSlots, type Exec } from "../../src/sources/ytdlp-spawn.ts";

// 부를 때마다 도는 수를 세고, finish 로 하나씩 끝내는 가짜 yt-dlp
function fakeYtdlp() {
  const finishers: Array<() => void> = [];
  let running = 0;
  let most = 0;
  const exec = ((..._args: unknown[]) => {
    most = Math.max(most, ++running);
    return new Promise((resolve) => {
      finishers.push(() => {
        running--;
        resolve({ stdout: "ok", stderr: "" });
      });
    });
  }) as unknown as Exec;
  return { exec, running: () => running, most: () => most, finish: () => finishers.shift()?.() };
}
// assert 가 실패해도 끝나지 않은 가짜 때문에 테스트가 멈춰 있지 않게, 남은 것을 다 끝낸 뒤 실패를 던진다
async function settled(ytdlp: ReturnType<typeof fakeYtdlp>, all: Array<Promise<unknown>>, body: () => Promise<void>) {
  try {
    await body();
  } finally {
    for (let guard = 0; guard < 20; guard++) {
      ytdlp.finish();
      await tick();
    }
    await Promise.allSettled(all);
  }
}
const tick = () => new Promise((done) => setImmediate(done));

afterEach(() => {
  useExec(null);
  useLaneSizes(null);
  useCpuSlots(null);
});

test("CPU 상한이 없으면 제한하지 않고, 있으면 CPU 하나를 남긴 수만큼(적어도 하나) 동시에 돌린다", () => {
  assert.equal(cpuSlots(null), Infinity);
  assert.equal(cpuSlots(0.5), 1);
  assert.equal(cpuSlots(1), 1);
  assert.equal(cpuSlots(2), 1);
  assert.equal(cpuSlots(3.9), 2);
  assert.equal(cpuSlots(8), 7);
});

test("동시 실행 수가 하나면 곡 찾기와 미리 받기가 줄이 달라도 차례로 돈다", async () => {
  const ytdlp = fakeYtdlp();
  useExec(ytdlp.exec);
  useLaneSizes({ lookup: 2, background: 2 });
  useCpuSlots(1);
  const all = [run("https://youtu.be/a"), run("https://youtu.be/b", {}, { job: "prefetch" }), run("https://youtu.be/c")];
  await settled(ytdlp, all, async () => {
    for (let done = 0; done < all.length; done++) {
      await tick();
      assert.equal(ytdlp.running(), 1);
      ytdlp.finish();
      await tick();
    }
    assert.deepEqual(await Promise.all(all), ["ok", "ok", "ok"]);
  });
  assert.equal(ytdlp.most(), 1);
});

test("기다리는 것 가운데 곡 찾기가 미리 받기보다 먼저 돈다", async () => {
  const ytdlp = fakeYtdlp();
  const order: string[] = [];
  useExec(((url: string, ...rest: unknown[]) => {
    order.push(url);
    return (ytdlp.exec as unknown as (...args: unknown[]) => unknown)(url, ...rest);
  }) as unknown as Exec);
  useLaneSizes({ lookup: 2, background: 2 });
  useCpuSlots(1);
  const all = [run("first"), run("prefetch", {}, { job: "prefetch" }), run("lookup")];
  await settled(ytdlp, all, async () => {
    for (let done = 0; done < all.length; done++) {
      await tick();
      ytdlp.finish();
      await tick();
    }
    await Promise.all(all);
  });
  assert.deepEqual(order, ["first", "lookup", "prefetch"]);
});

test("제한이 없으면 줄 크기만큼 동시에 돈다", async () => {
  const ytdlp = fakeYtdlp();
  useExec(ytdlp.exec);
  useLaneSizes({ lookup: 2, background: 2 });
  useCpuSlots(Infinity);
  const all = [run("https://youtu.be/a"), run("https://youtu.be/b", {}, { job: "prefetch" }), run("https://youtu.be/c")];
  await settled(ytdlp, all, async () => {
    await tick();
    assert.equal(ytdlp.running(), 3);
  });
});
