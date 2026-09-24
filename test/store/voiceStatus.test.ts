// src/store/voiceStatus.ts — 봇이 음성 채널 상태에 마지막으로 쓴 값

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/tempStore.ts";
import * as voiceStatus from "../../src/store/voiceStatus.ts";

const store = openTempStore("voice-status-");
after(() => store.close());

test("채널마다 마지막 값만 남기고, 비우면 지운다", () => {
  voiceStatus.save("c1", "▶️ 첫 곡");
  voiceStatus.save("c1", "▶️ 둘째 곡");
  voiceStatus.save("c2", "💤 쉬는 중");
  assert.deepEqual(voiceStatus.load().sort(), [
    ["c1", "▶️ 둘째 곡"],
    ["c2", "💤 쉬는 중"],
  ]);

  voiceStatus.save("c2", "");
  assert.deepEqual(voiceStatus.load(), [["c1", "▶️ 둘째 곡"]]);
});
