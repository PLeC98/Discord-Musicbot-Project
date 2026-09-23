"use strict";

// src/MusicPlayer.js releaseAudioProtection — 캐시 퇴거 보호 해제 계약
// 회귀 대상: 비활성 종료·강제 퇴장 경로가 currentTrack을 먼저 null해서
// cleanup의 unprotect(currentTrack 전제)가 건너뛰어져 보호 Set이 재시작까지 증가하던 누수.
// protect/unprotect는 순수 in-memory Set — DB 미접촉.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const CacheManager = require("../src/store/cacheManager");
const MusicPlayer = require("../src/MusicPlayer");

const release = MusicPlayer.prototype.releaseAudioProtection;
const isProtected = (key) => CacheManager._protectedKeys.has(key);

test("currentTrack이 먼저 null된 종료 경로에서도 기억된 키가 해제됨 (L-02 회귀)", () => {
  CacheManager.protect("k1");
  const player = { _protectedAudioKey: "k1", currentTrack: null }; // 강제 퇴장/비활성 종료가 null한 상태
  release.call(player);
  assert.equal(isProtected("k1"), false, "보호 Set에 잔존하지 않음");
  assert.equal(player._protectedAudioKey, null);
});

test("기억된 키가 없으면 currentTrack의 키로 폴백 해제", () => {
  CacheManager.protect("k2");
  const player = { _protectedAudioKey: null, currentTrack: { audioSourceKey: "k2" } };
  release.call(player);
  assert.equal(isProtected("k2"), false);
});

test("둘 다 없으면 no-op — 다른 보호 키에 무영향", () => {
  CacheManager.protect("k3");
  const player = { _protectedAudioKey: null, currentTrack: null };
  release.call(player);
  assert.equal(isProtected("k3"), true, "무관한 키는 유지");
  CacheManager.unprotect("k3");
});

// ── 대기열 보호 (길드별, 통째로 교체) ────────────────────────

test("대기열 보호는 통째로 교체된다 — 해제를 따로 부르지 않는다", () => {
  CacheManager.setQueuedKeys("g1", ["a", "b", "c"]);
  assert.deepEqual([...CacheManager._liveKeys()].sort(), ["a", "b", "c"]);

  CacheManager.setQueuedKeys("g1", ["b"]); // a, c가 대기열에서 빠짐
  assert.deepEqual([...CacheManager._liveKeys()], ["b"]);

  CacheManager.setQueuedKeys("g1", []);
  assert.equal(CacheManager._liveKeys().size, 0);
});

test("한 길드의 교체가 다른 길드의 보호를 건드리지 않는다", () => {
  CacheManager.setQueuedKeys("g1", ["shared", "only1"]);
  CacheManager.setQueuedKeys("g2", ["shared", "only2"]);

  CacheManager.setQueuedKeys("g1", []); // g1이 대기열을 비움

  const live = CacheManager._liveKeys();
  assert.equal(live.has("shared"), true, "g2가 아직 쓰고 있으므로 유지");
  assert.equal(live.has("only2"), true);
  assert.equal(live.has("only1"), false);

  CacheManager.setQueuedKeys("g2", []);
  assert.equal(CacheManager._liveKeys().size, 0);
});

test("재생 중 보호와 대기열 보호는 합쳐진다", () => {
  CacheManager.protect("playing");
  CacheManager.setQueuedKeys("g1", ["queued"]);

  assert.deepEqual([...CacheManager._liveKeys()].sort(), ["playing", "queued"]);

  CacheManager.unprotect("playing");
  assert.deepEqual([...CacheManager._liveKeys()], ["queued"], "대기열 보호는 남는다");

  CacheManager.setQueuedKeys("g1", []);
});

test("빈 값·falsy 키는 보호에 들어가지 않는다", () => {
  CacheManager.setQueuedKeys("g1", ["ok", null, undefined, ""]);
  assert.deepEqual([...CacheManager._liveKeys()], ["ok"]);

  CacheManager.setQueuedKeys(null, ["ignored"]); // guildId 없음 — 무시
  assert.deepEqual([...CacheManager._liveKeys()], ["ok"]);

  CacheManager.setQueuedKeys("g1", []);
});
