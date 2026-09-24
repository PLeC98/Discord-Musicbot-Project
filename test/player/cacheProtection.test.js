// src/player/Player.js releaseAudioProtection — 캐시 퇴거 보호 해제 계약
// 회귀 대상: 비활성 종료·강제 퇴장 경로가 currentTrack을 먼저 null해서
// cleanup의 unprotect(currentTrack 전제)가 건너뛰어져 보호 Set이 재시작까지 증가하던 누수.
// protect/unprotect는 순수 in-memory Set — DB 미접촉.

import { test } from "node:test";
import assert from "node:assert/strict";
import audioCache from "../../src/store/audioCache.ts";
import MusicPlayer from "../../src/player/Player.js";

const release = MusicPlayer.prototype.releaseAudioProtection;
const isProtected = (key) => audioCache._protectedKeys.has(key);

test("currentTrack이 먼저 null된 종료 경로에서도 기억된 키가 해제됨 (L-02 회귀)", () => {
  audioCache.protect("k1");
  const player = { _protectedAudioKey: "k1", currentTrack: null }; // 강제 퇴장/비활성 종료가 null한 상태
  release.call(player);
  assert.equal(isProtected("k1"), false, "보호 Set에 잔존하지 않음");
  assert.equal(player._protectedAudioKey, null);
});

test("기억된 키가 없으면 currentTrack의 음원 주소에서 계산한 키로 폴백 해제", () => {
  audioCache.protect("yt:k2k2k2k2k2k");
  const player = { _protectedAudioKey: null, currentTrack: { audioUrl: "https://www.youtube.com/watch?v=k2k2k2k2k2k" } };
  release.call(player);
  assert.equal(isProtected("yt:k2k2k2k2k2k"), false);
});

test("둘 다 없으면 no-op — 다른 보호 키에 무영향", () => {
  audioCache.protect("k3");
  const player = { _protectedAudioKey: null, currentTrack: null };
  release.call(player);
  assert.equal(isProtected("k3"), true, "무관한 키는 유지");
  audioCache.unprotect("k3");
});

// ── 대기열 보호 (길드별, 통째로 교체) ────────────────────────

test("대기열 보호는 통째로 교체된다 — 해제를 따로 부르지 않는다", () => {
  audioCache.setQueuedKeys("g1", ["a", "b", "c"]);
  assert.deepEqual([...audioCache._liveKeys()].sort(), ["a", "b", "c"]);

  audioCache.setQueuedKeys("g1", ["b"]); // a, c가 대기열에서 빠짐
  assert.deepEqual([...audioCache._liveKeys()], ["b"]);

  audioCache.setQueuedKeys("g1", []);
  assert.equal(audioCache._liveKeys().size, 0);
});

test("한 길드의 교체가 다른 길드의 보호를 건드리지 않는다", () => {
  audioCache.setQueuedKeys("g1", ["shared", "only1"]);
  audioCache.setQueuedKeys("g2", ["shared", "only2"]);

  audioCache.setQueuedKeys("g1", []); // g1이 대기열을 비움

  const live = audioCache._liveKeys();
  assert.equal(live.has("shared"), true, "g2가 아직 쓰고 있으므로 유지");
  assert.equal(live.has("only2"), true);
  assert.equal(live.has("only1"), false);

  audioCache.setQueuedKeys("g2", []);
  assert.equal(audioCache._liveKeys().size, 0);
});

test("재생 중 보호와 대기열 보호는 합쳐진다", () => {
  audioCache.protect("playing");
  audioCache.setQueuedKeys("g1", ["queued"]);

  assert.deepEqual([...audioCache._liveKeys()].sort(), ["playing", "queued"]);

  audioCache.unprotect("playing");
  assert.deepEqual([...audioCache._liveKeys()], ["queued"], "대기열 보호는 남는다");

  audioCache.setQueuedKeys("g1", []);
});

test("빈 값·falsy 키는 보호에 들어가지 않는다", () => {
  audioCache.setQueuedKeys("g1", ["ok", null, undefined, ""]);
  assert.deepEqual([...audioCache._liveKeys()], ["ok"]);

  audioCache.setQueuedKeys(null, ["ignored"]); // guildId 없음 — 무시
  assert.deepEqual([...audioCache._liveKeys()], ["ok"]);

  audioCache.setQueuedKeys("g1", []);
});
