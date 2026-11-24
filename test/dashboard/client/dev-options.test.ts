// dashboard/src/composables/dev-options.ts: 봇 정보 탭의 Version을 누를 때마다의 결과(안드로이드의 빌드 번호처럼 처음 두 번은 조용히, 그 뒤로 남은 횟수, 다 누르면 켜짐)

import { test } from "node:test";
import assert from "node:assert/strict";
import { TAPS_TO_UNLOCK, tapOutcome } from "../../../dashboard/src/composables/dev-options.ts";

test("꺼져 있으면 일곱 번째에 켜지고, 세 번째부터 남은 횟수를 알린다", () => {
  assert.equal(TAPS_TO_UNLOCK, 7);
  const kinds = Array.from({ length: TAPS_TO_UNLOCK }, (_, i) => tapOutcome(i + 1, false));
  assert.deepEqual(kinds, [{ kind: "quiet" }, { kind: "quiet" }, { kind: "left", left: 4 }, { kind: "left", left: 3 }, { kind: "left", left: 2 }, { kind: "left", left: 1 }, { kind: "unlocked" }]);
});

test("켜져 있으면 몇 번째든 이미 켜져 있다고만 한다", () => {
  for (const taps of [0, 1, 7, 20]) assert.deepEqual(tapOutcome(taps, true), { kind: "already" });
});
