// src/rules/latency.ts: 지연의 판정과 기록 평균(/ping, 대시보드 봇 상태 탭)

import { test } from "node:test";
import assert from "node:assert/strict";
import { averageOf, historyMinutes, linkLevel, responseLevel } from "../../src/rules/latency.ts";
import { LIMITS } from "../../src/rules/status-levels.ts";

test("연결 지연은 대시보드의 핑과 같은 기준", () => {
  const [warn, bad] = LIMITS.ping;
  assert.deepEqual([0, warn - 1, warn, bad - 1, bad].map(linkLevel), ["ok", "ok", "warn", "warn", "bad"]);
});

test("응답 시간은 1초부터 주의, 2초부터 위험(상호작용은 3초 안에 답해야 한다)", () => {
  assert.deepEqual([0, 999, 1000, 1999, 2000].map(responseLevel), ["ok", "ok", "warn", "warn", "bad"]);
});

test("기록 구간은 1분이 안 돼도 1분, 평균은 정수이고 비었으면 0", () => {
  assert.equal(historyMinutes(15_000, 0), 1);
  assert.equal(historyMinutes(15_000, 60), 15);
  assert.equal(averageOf([40, 41, 43]), 41);
  assert.equal(averageOf([]), 0);
});
