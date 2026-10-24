// src/rules/duration-shown.ts — 곡 길이 표시는 처음 보인 값을 흔들지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { shownDuration } from "../../src/rules/duration-shown.ts";

test("모르던 길이는 어느 값이든 채운다", () => {
  assert.deepEqual(shownDuration({ duration: 0 }, 181.2, "provided"), { duration: 181.2, durationSource: "provided" });
  assert.deepEqual(shownDuration({}, 181.2, "measured"), { duration: 181.2, durationSource: "measured" });
});

test("보이던 길이는 출처가 준 값으로 바꾸지 않는다", () => {
  assert.equal(shownDuration({ duration: 180 }, 190, "provided"), null);
});

test("캐시한 음원을 잰 값이 2초 넘게 다를 때만 바꾼다", () => {
  assert.equal(shownDuration({ duration: 180 }, 182, "measured"), null, "2초는 그대로");
  assert.equal(shownDuration({ duration: 180 }, 178, "measured"), null);
  assert.deepEqual(shownDuration({ duration: 180 }, 182.01, "measured"), { duration: 182.01, durationSource: "measured" });
  assert.deepEqual(shownDuration({ duration: 180 }, 177.99, "measured"), { duration: 177.99, durationSource: "measured" });
});

test("새 값을 모르면 그대로", () => {
  assert.equal(shownDuration({ duration: 0 }, null, "measured"), null);
  assert.equal(shownDuration({ duration: 0 }, 0, "provided"), null);
});
