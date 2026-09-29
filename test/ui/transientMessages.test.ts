import { test } from "node:test";
import assert from "node:assert/strict";
import { markTransient, isTransient, scheduleDelete } from "../../src/ui/transientMessages.ts";
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
