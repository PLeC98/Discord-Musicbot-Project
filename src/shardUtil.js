"use strict";

// 샤드 판별 유틸.
//
// discord.js ShardingManager(process 모드)는 각 샤드 프로세스에 환경변수를 주입한다:
//   SHARDING_MANAGER=true, SHARDS=<이 프로세스의 샤드 id>, SHARD_COUNT=<전체 샤드 수>
// 비샤딩(`node index.js`)으로 직접 기동하면 이 변수들이 없다.
//
// "단일 인스턴스여야 하는 부수효과"(커맨드 전역 배포, bgutil 포트 서버, 웹 대시보드 포트)는
// 샤드 0(또는 비샤딩)에서만 실행해야 한다. 아니면 샤드 수만큼 중복 배포/포트 충돌이 난다.

function isSharded() {
  return process.env.SHARDING_MANAGER === "true" || process.env.SHARDS !== undefined;
}

// 이 프로세스가 "대표 샤드"인가?
//   - 비샤딩: 항상 true (단일 프로세스이므로)
//   - 샤딩: 샤드 id가 0일 때만 true
function isPrimaryShard() {
  if (!isSharded()) return true;
  return shardId() === 0;
}

// 이 프로세스의 샤드 id (비샤딩이면 null).
// process 모드에서 SHARDS는 단일 정수. 혹시 리스트로 오면 첫 값 사용.
function shardId() {
  const raw = process.env.SHARDS;
  if (raw === undefined) return null;
  const first = String(raw).split(",")[0].trim();
  const n = Number(first);
  return Number.isInteger(n) ? n : null;
}

// 전체 샤드 수 (비샤딩이면 1).
function shardCount() {
  const n = Number(process.env.SHARD_COUNT);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

module.exports = { isSharded, isPrimaryShard, shardId, shardCount };
