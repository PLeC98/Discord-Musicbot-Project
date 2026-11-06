// src/dashboard/regex-filter.ts: 캐시 DB 의 정규식을 따로 도는 스레드에서 맞춘다. 실패는 그 맞추기만, 다음 것은 이어 맞춘다

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRegexes } from "../../src/dashboard/regex-filter.ts";

test("스레드가 실패를 돌려주면 그 맞추기만 실패하고, 함께 기다리던 것은 이어 맞춘다", async () => {
  const [broken, next] = await Promise.allSettled([matchRegexes(["("], [["x"]]), matchRegexes(["^a"], [["abc"], ["b"], [null]])]);
  assert.equal(broken.status, "rejected");
  assert.deepEqual(next, { status: "fulfilled", value: { kind: "hits", hits: [0] } });
});
