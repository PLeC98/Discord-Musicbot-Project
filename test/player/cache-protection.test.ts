// src/player/player.ts releaseAudioProtection · src/store/audio-cache.ts protect — 재생 중인 곡의 캐시 보호
// 보호는 저장 계층이 서버마다 들고 있다. 강제 퇴장 · 비활성 종료처럼 currentTrack 을 먼저 비우는 종료 경로에서도 풀리고,
// 두 서버가 같은 곡을 틀다 한쪽이 끝나도 다른 쪽 보호는 남는다. 메모리만 쓰고 DB 는 건드리지 않는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as audioCache from "../../src/store/audio-cache.ts";
import { Player } from "../../src/player/player.ts";

const release = Player.prototype.releaseAudioProtection;
const isProtected = (key: string) => audioCache._liveKeys().has(key);

test("currentTrack 을 먼저 비운 종료 경로에서도 그 서버의 보호가 풀린다", () => {
  audioCache.protect("g1", "k1");
  release.call({ guild: { id: "g1" }, currentTrack: null }); // 강제 퇴장 · 비활성 종료가 비운 상태
  assert.equal(isProtected("k1"), false);
});

test("두 서버가 같은 곡을 틀다 한쪽이 끝나도 다른 쪽 보호는 남는다", () => {
  audioCache.protect("g1", "shared");
  audioCache.protect("g2", "shared");
  release.call({ guild: { id: "g1" }, currentTrack: null });
  assert.equal(isProtected("shared"), true, "g2 가 아직 튼다");
  release.call({ guild: { id: "g2" }, currentTrack: null });
  assert.equal(isProtected("shared"), false);
});

test("한 서버가 다른 곡으로 넘어가면 앞 곡의 보호는 풀린다", () => {
  audioCache.protect("g1", "first");
  audioCache.protect("g1", "second");
  assert.equal(isProtected("first"), false);
  assert.equal(isProtected("second"), true);
  audioCache.protect("g1", null); // 키가 없는 곡(음원 주소를 아직 모른다)으로 넘어가면 보호가 없다
  assert.equal(isProtected("second"), false);
});

test("다른 서버의 해제는 무관한 보호를 건드리지 않는다", () => {
  audioCache.protect("g3", "k3");
  release.call({ guild: { id: "g4" }, currentTrack: null });
  assert.equal(isProtected("k3"), true);
  audioCache.unprotect("g3");
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
  audioCache.protect("g9", "playing");
  audioCache.setQueuedKeys("g1", ["queued"]);

  assert.deepEqual([...audioCache._liveKeys()].sort(), ["playing", "queued"]);

  audioCache.unprotect("g9");
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
