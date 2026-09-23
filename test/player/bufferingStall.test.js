"use strict";

// src/MusicPlayer.js `_checkBufferingStall` — 재생이 시작되지 않은 채 멈춘 곡을 깨우는 판정
// 프로토타입 호출 — 실 오디오 없이 판정만 검증한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AudioPlayerStatus } = require("@discordjs/voice");
const MusicPlayer = require("../../src/player/Player");

const check = MusicPlayer.prototype._checkBufferingStall;

function fakePlayer({ status = AudioPlayerStatus.Buffering, since = 0, inputAt = null, reason = null } = {}) {
  return {
    currentTrack: { title: "곡", platform: "youtube" },
    audioPlayer: {
      state: { status },
      stops: [],
      stop(force) {
        this.stops.push(force);
      },
    },
    pendingEndReason: reason,
    _bufferingSince: since,
    _inputProgressAt: inputAt,
    _bufferingTimer: null,
    _clearBufferingWatch: MusicPlayer.prototype._clearBufferingWatch,
    _trackLabel: MusicPlayer.prototype._trackLabel,
  };
}

test("입력 없이 15초 버퍼링이면 강제로 멈춰 복구 경로로 보낸다", () => {
  const p = fakePlayer({ since: 0 });
  check.call(p, 14_999);
  assert.deepEqual(p.audioPlayer.stops, [], "아직 이르다");
  check.call(p, 15_000);
  assert.deepEqual(p.audioPlayer.stops, [true], "force 없이는 Buffering에서 Idle로 가지 않는다");
  assert.equal(p.pendingEndReason, "buffering-stall");
});

test("입력이 들어오고 있으면 버퍼링이 길어도 멈추지 않는다", () => {
  const p = fakePlayer({ since: 0, inputAt: 10_000 });
  check.call(p, 20_000);
  assert.deepEqual(p.audioPlayer.stops, []);
  check.call(p, 25_000);
  assert.deepEqual(p.audioPlayer.stops, [true], "마지막 입력 뒤 15초");
});

test("이미 버퍼링이 아니면 아무것도 하지 않는다", () => {
  const p = fakePlayer({ status: AudioPlayerStatus.Playing, since: 0 });
  check.call(p, 60_000);
  assert.deepEqual(p.audioPlayer.stops, []);
});

test("이미 정해진 종료 사유는 덮지 않는다", () => {
  const p = fakePlayer({ since: 0, reason: "skip" });
  check.call(p, 15_000);
  assert.equal(p.pendingEndReason, "skip");
});
