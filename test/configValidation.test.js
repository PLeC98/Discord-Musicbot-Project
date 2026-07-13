"use strict";

// config.js envInt 범위 검증
// dotenv는 이미 설정된 process.env를 덮어쓰지 않으므로, require 전에 세팅한 값이
// .env보다 우선한다 — 파일별 자식 프로세스라 다른 테스트에 영향 없음.

process.env.DASHBOARD_PORT = "99999"; // 포트 범위 초과
process.env.RATE_LIMIT_API_MAX = "-5"; // 음수 상한
process.env.SSE_HEARTBEAT_SEC = "0"; // 0초 하트비트 (1ms급 타이머 계열)
process.env.CACHE_MAX_FILES = "abc"; // 숫자 아님 (기존 동작 회귀)
process.env.CACHE_EVICT_INTERVAL_HOURS = "2"; // 범위 내 정상값
process.env.SHARD_SPAWN_TIMEOUT = "-1"; // -1 = 무제한 (discord.js 관례) — 허용

const { test } = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config");

test("범위 초과 값은 기본값으로 폴백 (포트/음수/0초 타이머)", () => {
  assert.equal(config.dashboard.port, 33333, "99999 포트 → 기본값");
  assert.equal(config.dashboard.rateLimit.apiMax, 120, "음수 상한 → 기본값");
  assert.equal(config.dashboard.sse.heartbeatMs, 20000, "0초 하트비트 → 기본값");
});

test("숫자 아님은 기존대로 기본값 (회귀)", () => {
  assert.equal(config.cache.maxFiles, 500);
});

test("범위 내 값과 특수 허용값(-1 무제한)은 그대로 통과", () => {
  assert.equal(config.cache.evictIntervalMs, 2 * 3600 * 1000);
  assert.equal(config.sharding.spawnTimeout, -1);
});
