// 테스트용 설정 덮어쓰기 창구(test/helpers/config.ts)가 바꾼 것을 빠짐없이 되돌리는지 본다.

import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../config.ts";
import { withConfig } from "./helpers/config.ts";

test("준 칸만 바꾸고 끝나면 되돌린다. 안쪽 객체는 합친다", () => {
  const before = structuredClone(config.bot);
  const seen = withConfig({ bot: { maxQueueSize: 3 } }, () => ({ max: config.bot.maxQueueSize, other: config.bot.leaveDelayAloneMs }));
  assert.deepEqual(seen, { max: 3, other: before.leaveDelayAloneMs });
  assert.deepEqual(config.bot, before);
});

test("비동기 시험도 끝난 뒤에 되돌린다", async () => {
  const before = config.bot.maxQueueSize;
  await withConfig({ bot: { maxQueueSize: 7 } }, async () => {
    await new Promise(setImmediate);
    assert.equal(config.bot.maxQueueSize, 7);
  });
  assert.equal(config.bot.maxQueueSize, before);
});

test("던져도 되돌린다(동기 · 비동기)", async () => {
  const before = config.sponsorblock.enabled;
  assert.throws(() =>
    withConfig({ sponsorblock: { enabled: !before } }, () => {
      throw new Error("x");
    }),
  );
  assert.equal(config.sponsorblock.enabled, before);
  await assert.rejects(
    withConfig({ sponsorblock: { enabled: !before } }, async () => {
      throw new Error("y");
    }),
  );
  assert.equal(config.sponsorblock.enabled, before);
});

test("없던 칸은 끝나면 지운다. 배열은 통째로 바꾼다", () => {
  const cats = config.sponsorblock.categories;
  withConfig({ bot: { __probe: 1 }, sponsorblock: { categories: ["intro"] } }, () => {
    assert.equal(Reflect.get(config.bot, "__probe"), 1);
    assert.deepEqual(config.sponsorblock.categories, ["intro"]);
  });
  assert.equal(Object.hasOwn(config.bot, "__probe"), false);
  assert.equal(config.sponsorblock.categories, cats);
});
