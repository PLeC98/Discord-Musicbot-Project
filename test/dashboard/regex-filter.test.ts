// src/dashboard/regex-filter.ts: 캐시 DB의 정규식을 별도 스레드에서 매칭한다. 실패 시 해당 작업만 실패하고 다음 작업은 이어서 매칭한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRegexes } from "../../src/dashboard/regex-filter.ts";

test("스레드가 실패를 반환하면 해당 작업만 실패하고, 함께 대기하던 작업은 이어서 매칭한다", async () => {
  const [broken, next] = await Promise.allSettled([matchRegexes(["("], [["x"]]), matchRegexes(["^a"], [["abc"], ["b"], [null]])]);
  assert.equal(broken.status, "rejected");
  assert.deepEqual(next, { status: "fulfilled", value: { kind: "hits", hits: [0] } });
});

test("값이 너무 길어 정규식 엔진의 한도를 넘으면(RangeError) 실패가 아니라 시간 초과와 같은 결과를 돌려준다. 다음 작업도 이어서 처리한다", async () => {
  const [huge, next] = await Promise.all([matchRegexes(["(a|b)*c"], [["ab".repeat(5_000_000)]], { timeoutMs: 10_000 }), matchRegexes(["^a"], [["abc"]])]);
  assert.deepEqual(huge, { kind: "timeout" });
  assert.deepEqual(next, { kind: "hits", hits: [0] });
});
