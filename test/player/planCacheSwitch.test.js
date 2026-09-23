"use strict";

// src/MusicPlayer.js `_planCacheSwitch` — 스트림이 죽었을 때 캐시로 무이음 전환을 예약하는 판정
//
// 예약하지 '않아야' 하는 경우가 핵심이다. 잘못 예약하면 엉뚱한 곡·엉뚱한 위치로 갈아타거나,
// 이미 끝난 재생에 손을 대게 된다. 그럴 땐 아무것도 안 해야 기존 경로(Idle → play(위치))가 받는다.
//
// 프로토타입 호출 — 실 오디오·음성 연결 없이 판정만 검증한다(playbackLoop.test.js와 같은 방식).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const MusicPlayer = require("../../src/player/Player");

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

function fakePlayer({ track, file = null, startOffsetMs = 0 } = {}) {
  return {
    currentTrack: track,
    currentDownloadedFile: file,
    currentTrackStartOffsetMs: startOffsetMs,
    _trackLabel: MusicPlayer.prototype._trackLabel,
  };
}

const TRACK = { title: "곡", url: "https://y/1", duration: 200, platform: "youtube" };

// ── 예약하지 않아야 하는 경우 ────────────────────────────────

test("캐시 파일이 없으면 예약하지 않는다 (기존 경로가 받는다)", () => {
  const sp = fakeSplicer();
  planCacheSwitch.call(fakePlayer({ track: TRACK, file: null }), sp, TRACK);
  assert.equal(sp.calls.length, 0);
});

test("캐시 경로가 있어도 파일이 실제로 없으면 예약하지 않는다", () => {
  const sp = fakeSplicer();
  planCacheSwitch.call(fakePlayer({ track: TRACK, file: path.join(os.tmpdir(), "없는파일-xyz.opus") }), sp, TRACK);
  assert.equal(sp.calls.length, 0);
});

test("캐시 파일이 비어 있으면 예약하지 않는다 (다운로드 중일 수 있다)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-"));
  const empty = path.join(dir, "empty.opus");
  fs.writeFileSync(empty, "");
  const sp = fakeSplicer();
  planCacheSwitch.call(fakePlayer({ track: TRACK, file: empty }), sp, TRACK);
  assert.equal(sp.calls.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("트랙이 이미 바뀌었으면 예약하지 않는다 (늦게 도착한 오류)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-"));
  const file = path.join(dir, "c.opus");
  fs.writeFileSync(file, Buffer.alloc(4096));
  const sp = fakeSplicer();
  const player = fakePlayer({ track: { ...TRACK, title: "다음 곡" }, file });
  planCacheSwitch.call(player, sp, TRACK); // 오류는 이전 곡의 것
  assert.equal(sp.calls.length, 0, "다음 곡의 캐시로 갈아타면 안 된다");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("이미 파괴됐거나 예약된 스플라이서는 건드리지 않는다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-"));
  const file = path.join(dir, "c.opus");
  fs.writeFileSync(file, Buffer.alloc(4096));
  const player = fakePlayer({ track: TRACK, file });

  const dead = fakeSplicer({ destroyed: true });
  planCacheSwitch.call(player, dead, TRACK);
  assert.equal(dead.calls.length, 0, "파괴됨");

  const pending = fakeSplicer({ switchPending: true });
  planCacheSwitch.call(player, pending, TRACK);
  assert.equal(pending.calls.length, 0, "이미 예약됨");

  planCacheSwitch.call(player, null, TRACK); // 던지지 않는다
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 예약하는 경우 ────────────────────────────────────────────

test("캐시가 있으면 현재 위치보다 앞선 지점에 예약한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-"));
  const file = path.join(dir, "c.opus");
  fs.writeFileSync(file, Buffer.alloc(4096));

  const sp = fakeSplicer({ emittedMs: 12_000 });
  planCacheSwitch.call(fakePlayer({ track: TRACK, file, startOffsetMs: 30_000 }), sp, TRACK);

  assert.equal(sp.calls.length, 1);
  const { atMs, next } = sp.calls[0];
  assert.ok(atMs > 12_000, `전환 지점은 현재보다 앞이어야 한다 (${atMs}ms)`);
  assert.ok(atMs - 12_000 >= 1000, "디코더 기동을 덮을 만큼 여유가 있어야 한다");
  assert.ok(next, "디코더 출력이 넘어갔다");
  next.destroy?.();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("예약했는지를 돌려준다 — 청크 스트림이 이어받을지 이걸로 정한다", () => {
  assert.equal(planCacheSwitch.call(fakePlayer({ track: TRACK, file: null }), fakeSplicer(), TRACK), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-"));
  const file = path.join(dir, "c.opus");
  fs.writeFileSync(file, Buffer.alloc(4096));
  const sp = fakeSplicer();
  assert.equal(planCacheSwitch.call(fakePlayer({ track: TRACK, file }), sp, TRACK), true);
  sp.calls[0].next.destroy?.();
  fs.rmSync(dir, { recursive: true, force: true });
});
