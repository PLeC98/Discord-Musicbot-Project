// src/player/Player.js `_planCacheSwitch` — 스트림이 죽었을 때 캐시로 무이음 전환을 예약하는 판정
//
// 예약하지 '않아야' 하는 경우가 핵심이다. 잘못 예약하면 엉뚱한 곡·엉뚱한 위치로 갈아타거나,
// 이미 끝난 재생에 손을 대게 된다. 그럴 땐 아무것도 안 해야 기존 경로(Idle → play(위치))가 받는다.
//
// 프로토타입 호출 — 실 오디오·음성 연결 없이 판정만 검증한다(playbackLoop.test.js와 같은 방식).
// 캐시 파일은 곡의 열쇠 자리(임시 폴더)에 진짜로 둔다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import MusicPlayer from "../../src/player/Player.js";
import audioCache from "../../src/store/audioCache.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-"));
const realDir = audioCache._cacheDir;
audioCache._cacheDir = DIR;
after(() => {
  audioCache._cacheDir = realDir;
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

const planCacheSwitch = MusicPlayer.prototype._planCacheSwitch;

function fakeSplicer({ destroyed = false, switchPending = false, emittedMs = 5000 } = {}) {
  const calls = [];
  return {
    destroyed,
    switchPending,
    emittedMs,
    slips: 0,
    calls,
    planSwitch(next, atMs) {
      calls.push({ next, atMs });
      this.switchPending = true;
      return true;
    },
    once() {},
  };
}

// 캐시 파일을 여는 디코더(ffmpeg)는 띄우지 않는다. 출력 자리만 있는 가짜
const fakeFfmpeg = () => ({ stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true, once() {}, on() {} });

function fakePlayer({ track, startOffsetMs = 0 } = {}) {
  return {
    currentTrack: track,
    playback: { startOffsetMs },
    io: { spawnFfmpeg: fakeFfmpeg },
    _trackLabel: MusicPlayer.prototype._trackLabel,
  };
}

const TRACK = { title: "곡", audioUrl: "https://www.youtube.com/watch?v=pcspcspcs01", duration: 200, platform: "youtube" };
const cacheFile = audioCache.getFilePath("yt:pcspcspcs01");

// 이 곡의 캐시 파일을 둔다. null 이면 없앤다
function cacheAs(content) {
  fs.rmSync(cacheFile, { force: true });
  if (content != null) fs.writeFileSync(cacheFile, content);
}

// ── 예약하지 않아야 하는 경우 ────────────────────────────────

test("캐시 파일이 없으면 예약하지 않는다 (기존 경로가 받는다)", () => {
  cacheAs(null);
  const sp = fakeSplicer();
  planCacheSwitch.call(fakePlayer({ track: TRACK }), sp, TRACK);
  assert.equal(sp.calls.length, 0);
});

test("캐시 파일이 비어 있으면 예약하지 않는다 (다운로드 중일 수 있다)", () => {
  cacheAs("");
  const sp = fakeSplicer();
  planCacheSwitch.call(fakePlayer({ track: TRACK }), sp, TRACK);
  assert.equal(sp.calls.length, 0);
});

test("트랙이 이미 바뀌었으면 예약하지 않는다 (늦게 도착한 오류)", () => {
  cacheAs(Buffer.alloc(4096));
  const sp = fakeSplicer();
  const player = fakePlayer({ track: { ...TRACK, title: "다음 곡" } });
  planCacheSwitch.call(player, sp, TRACK); // 오류는 이전 곡의 것
  assert.equal(sp.calls.length, 0, "다음 곡의 캐시로 갈아타면 안 된다");
});

test("이미 파괴됐거나 예약된 스플라이서는 건드리지 않는다", () => {
  cacheAs(Buffer.alloc(4096));
  const player = fakePlayer({ track: TRACK });

  const dead = fakeSplicer({ destroyed: true });
  planCacheSwitch.call(player, dead, TRACK);
  assert.equal(dead.calls.length, 0, "파괴됨");

  const pending = fakeSplicer({ switchPending: true });
  planCacheSwitch.call(player, pending, TRACK);
  assert.equal(pending.calls.length, 0, "이미 예약됨");

  planCacheSwitch.call(player, null, TRACK); // 던지지 않는다
});

// ── 예약하는 경우 ────────────────────────────────────────────

test("캐시가 있으면 현재 위치보다 앞선 지점에 예약한다", () => {
  cacheAs(Buffer.alloc(4096));

  const sp = fakeSplicer({ emittedMs: 12_000 });
  planCacheSwitch.call(fakePlayer({ track: TRACK, startOffsetMs: 30_000 }), sp, TRACK);

  assert.equal(sp.calls.length, 1);
  const { atMs, next } = sp.calls[0];
  assert.ok(atMs > 12_000, `전환 지점은 현재보다 앞이어야 한다 (${atMs}ms)`);
  assert.ok(atMs - 12_000 >= 1000, "디코더 기동을 덮을 만큼 여유가 있어야 한다");
  assert.ok(next, "디코더 출력이 넘어갔다");
  next.destroy?.();
});

test("예약했는지를 돌려준다 — 청크 스트림이 이어받을지 이걸로 정한다", () => {
  cacheAs(null);
  assert.equal(planCacheSwitch.call(fakePlayer({ track: TRACK }), fakeSplicer(), TRACK), false);

  cacheAs(Buffer.alloc(4096));
  const sp = fakeSplicer();
  assert.equal(planCacheSwitch.call(fakePlayer({ track: TRACK }), sp, TRACK), true);
  sp.calls[0].next.destroy?.();
});
