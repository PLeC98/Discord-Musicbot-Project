// dashboard/src/composables/load-generations.ts: 다시 읽기의 세대. 앞 세대를 끊고, 늦게 끝난 앞 세대가 새 세대를 건드리지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoadGenerations } from "../../../dashboard/src/composables/load-generations.ts";

test("새 세대를 열면 앞 세대의 요청을 끊고, 앞 세대의 끝맺음은 새 세대의 받는 중 표시를 지우지 않는다", () => {
  const gens = createLoadGenerations();
  const first = gens.begin();
  const old = gens.claim(0)!;
  assert.equal(gens.claim(0), null, "같은 세대에서 같은 블록은 한 번만");
  const second = gens.begin();
  assert.equal(old.signal.aborted, true, "앞 세대의 요청을 끊는다");
  assert.equal(gens.isCurrent(first), false);
  assert.equal(gens.isCurrent(second), true);
  const now = gens.claim(0)!;
  assert.ok(now, "새 세대는 같은 블록을 다시 받는다");
  old.done(); // 끊긴 앞 세대의 finally
  assert.equal(gens.claim(0), null, "새 세대의 받는 중 표시는 그대로");
  now.done();
  assert.ok(gens.claim(0), "끝나면 다시 받을 수 있다");
  assert.equal(now.signal.aborted, false);
});
