import { test } from "node:test";
import assert from "node:assert/strict";
import { markTransient, isTransient, scheduleDelete, RETRY_AFTER_MS } from "../../src/ui/transientMessages.ts";
import logger from "../../src/infra/log/logger.ts";
import sink from "../../src/infra/log/sink.ts";

test("잠깐 보이는 메시지: 때가 되면 지우고, 지우지 못하면 까닭을 debug 로 남긴다(삼키지 않는다)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const level = logger.level;
  logger.level = "debug";
  try {
    const deleted: string[] = [];
    scheduleDelete({ id: "ok", delete: async () => deleted.push("ok") }, 100);
    const from = sink.buffer.length;
    scheduleDelete({ id: "no", delete: async () => Promise.reject(new Error("Missing Access")) }, 100);
    t.mock.timers.tick(99);
    await new Promise(setImmediate);
    assert.deepEqual(deleted, []);
    t.mock.timers.tick(1);
    await new Promise(setImmediate);
    assert.deepEqual(deleted, ["ok"]);
    assert.ok(sink.buffer.slice(from).some((e) => e.level === "debug" && e.text.includes("Missing Access")));
  } finally {
    logger.level = level;
  }
});

test("잠깐 보이는 메시지: 네트워크가 끊겨 못 지웠으면 간격을 늘려 가며 다시 지운다. 권한 · 이미 지워짐은 다시 하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const offline = () => Object.assign(new Error("getaddrinfo ENOTFOUND discord.com"), { code: "ENOTFOUND" });
  let calls = 0;
  let online = false;
  scheduleDelete(
    {
      id: "net",
      delete: async () => {
        calls++;
        if (!online) throw offline();
      },
    },
    100,
  );
  const step = async (ms: number) => {
    t.mock.timers.tick(ms);
    await new Promise(setImmediate);
  };

  await step(100);
  assert.equal(calls, 1);
  await step(RETRY_AFTER_MS[0] - 1);
  assert.equal(calls, 1, "10초 기다린다");
  await step(1);
  assert.equal(calls, 2);
  online = true;
  await step(RETRY_AFTER_MS[1]);
  assert.equal(calls, 3, "다시 이어지면 지운다");
  await step(1_000_000);
  assert.equal(calls, 3, "지웠으면 더 하지 않는다");

  let denied = 0;
  scheduleDelete(
    {
      id: "denied",
      delete: async () => {
        denied++;
        throw new Error("Missing Access");
      },
    },
    100,
  );
  await step(100);
  await step(1_000_000);
  assert.equal(denied, 1);

  let never = 0;
  scheduleDelete(
    {
      id: "never",
      delete: async () => {
        never++;
        throw offline();
      },
    },
    100,
  );
  await step(100);
  for (const ms of RETRY_AFTER_MS) await step(ms);
  await step(1_000_000);
  assert.equal(never, RETRY_AFTER_MS.length + 1, "몇 번 해 보고 그만둔다");
});

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
