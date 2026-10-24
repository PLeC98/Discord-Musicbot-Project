// src/rules/latency.ts — 응답 시간의 등급(/ping · 운영자 패널)

import { test } from "node:test";
import assert from "node:assert/strict";
import { latencyGrade } from "../../src/rules/latency.ts";

test("100ms 아래는 좋음, 300ms 아래는 보통, 그 위는 나쁨", () => {
  assert.deepEqual([0, 99, 100, 299, 300, 5000].map(latencyGrade), ["good", "good", "fair", "fair", "poor", "poor"]);
});
