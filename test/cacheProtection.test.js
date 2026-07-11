"use strict";

// src/MusicPlayer.js releaseAudioProtection — 캐시 퇴거 보호 해제 계약 (감사 L-02).
// 회귀 대상: 비활성 종료·강제 퇴장 경로가 currentTrack을 먼저 null해서
// cleanup의 unprotect(currentTrack 전제)가 건너뛰어져 보호 Set이 재시작까지 증가하던 누수.
// protect/unprotect는 순수 in-memory Set — DB 미접촉.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const CacheManager = require("../src/CacheManager");
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
