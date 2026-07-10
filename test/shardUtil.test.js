"use strict";

// src/shardUtil.js — 샤드 판별 (discord.js ShardingManager 주입 env 기반)

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { isSharded, isPrimaryShard, shardId, shardCount } = require("../src/shardUtil");

const ENV_KEYS = ["SHARDING_MANAGER", "SHARDS", "SHARD_COUNT"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setEnv(vars = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("비샤딩(env 없음): 단일 프로세스가 대표", () => {
  setEnv();
  assert.equal(isSharded(), false);
  assert.equal(isPrimaryShard(), true);
  assert.equal(shardId(), null);
  assert.equal(shardCount(), 1);
});

test("샤드 0: 대표 샤드", () => {
  setEnv({ SHARDING_MANAGER: "true", SHARDS: "0", SHARD_COUNT: "2" });
  assert.equal(isSharded(), true);
  assert.equal(isPrimaryShard(), true);
  assert.equal(shardId(), 0);
  assert.equal(shardCount(), 2);
});

test("샤드 1+: 대표 아님", () => {
  setEnv({ SHARDING_MANAGER: "true", SHARDS: "1", SHARD_COUNT: "2" });
  assert.equal(isPrimaryShard(), false);
  assert.equal(shardId(), 1);
});

test("SHARDS만 있어도 샤딩으로 판정 (SHARDING_MANAGER 없이)", () => {
  setEnv({ SHARDS: "3" });
  assert.equal(isSharded(), true);
  assert.equal(isPrimaryShard(), false);
});

test("SHARDS 리스트 형태면 첫 값 사용", () => {
  setEnv({ SHARDS: "2,3" });
  assert.equal(shardId(), 2);
  assert.equal(isPrimaryShard(), false);
});

test("SHARDS가 정수가 아니면 id null → 대표 아님 (중복 부수효과 방지 쪽으로 안전)", () => {
  setEnv({ SHARDS: "abc" });
  assert.equal(shardId(), null);
  assert.equal(isPrimaryShard(), false);
});

test("SHARD_COUNT 비정상값은 1로 폴백", () => {
  setEnv({ SHARD_COUNT: "0" });
  assert.equal(shardCount(), 1);
  setEnv({ SHARD_COUNT: "abc" });
  assert.equal(shardCount(), 1);
});
