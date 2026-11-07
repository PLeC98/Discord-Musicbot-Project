// src/dashboard/regex-filter.ts: 캐시 DB의 정규식을 별도 스레드에서 매칭한다. 실패 시 해당 작업만 실패하고 다음 작업은 이어서 매칭한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRegexes } from "../../src/dashboard/regex-filter.ts";

test("스레드가 실패를 반환하면 해당 작업만 실패하고, 함께 대기하던 작업은 이어서 매칭한다", async () => {
  const [broken, next] = await Promise.allSettled([matchRegexes(["("], [["x"]]), matchRegexes(["^a"], [["abc"], ["b"], [null]])]);
  assert.equal(broken.status, "rejected");
  assert.deepEqual(next, { status: "fulfilled", value: { kind: "hits", hits: [0] } });
});
