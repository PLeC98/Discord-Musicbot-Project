// src/rules/loop-cycle.ts — 반복 버튼의 순환

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLoopMode } from "../../src/rules/loop-cycle.ts";
import type { Loop } from "../../src/player/track-state.ts";

test("버튼의 다음 모드는 끔 → 한곡 → 대기열 → 끔", () => {
  const modes: Array<Loop | "off"> = [false, "off", "track", "queue"];
  assert.deepEqual(modes.map(nextLoopMode), ["track", "track", "queue", false]);
});
