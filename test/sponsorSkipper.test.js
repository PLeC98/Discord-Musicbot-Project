"use strict";

// src/SponsorSkipper.js — 발동 판정(decide) 순수 로직: 교차 감지, 수동 진입 배제, 아웃트로→종료.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const SponsorSkipper = require("../src/SponsorSkipper");

const segs = (...pairs) => pairs.map(([start, end]) => ({ start, end, categories: ["music_offtopic"] }));

test("decide: 인트로(start=0) — 신규 재생(prevSec=-1)에서 발동", () => {
  const d = SponsorSkipper.decide(segs([0, 8]), -1, 0.5, 200);
  assert.equal(d.action, "seek");
  assert.equal(d.toSec, 8);
  assert.equal(d.prevSec, 8);
});

test("decide: 중간 구간 — 시작 경계를 넘어선 틱에 발동", () => {
  // prev=100, cur=101 사이에 start=100.5 들어옴
  const d = SponsorSkipper.decide(segs([100.5, 130]), 100, 101, 240);
  assert.equal(d.action, "seek");
  assert.equal(d.toSec, 130);
});

test("decide: 아직 시작 전이면 발동 안 함", () => {
  const d = SponsorSkipper.decide(segs([100, 130]), 50, 51, 240);
  assert.equal(d.action, null);
  assert.equal(d.prevSec, 51); // prevSec만 전진
});

test("decide: 수동으로 구간 안에 진입(prevSec=구간중간) → 발동 안 함", () => {
  // 사용자가 t=110(구간 100~130 내부)로 seek → onPlayStart가 prevSec=110으로 리셋
  const d = SponsorSkipper.decide(segs([100, 130]), 110, 111, 240);
  assert.equal(d.action, null); // start(100) > prevSec(110) 거짓 → 스킵 안 걸림
});

test("decide: 구간 시작 정확히 지점으로 seek하면(prevSec=start) 발동 안 함", () => {
  const d = SponsorSkipper.decide(segs([100, 130]), 100, 100.4, 240);
  assert.equal(d.action, null);
});

test("decide: 아웃트로(seg.end ≈ 트랙 끝) → end 액션", () => {
  const d = SponsorSkipper.decide(segs([230, 240]), 229, 231, 240);
  assert.equal(d.action, "end");
  assert.equal(d.prevSec, 240);
});

test("decide: duration 미상(0)이면 끝 구간도 seek로 처리", () => {
  const d = SponsorSkipper.decide(segs([230, 240]), 229, 231, 0);
  assert.equal(d.action, "seek");
  assert.equal(d.toSec, 240);
});

test("decide: 한 틱에 하나만 — 가장 이른 미처리 구간", () => {
  const d = SponsorSkipper.decide(segs([10, 20], [30, 40]), 5, 35, 200);
  assert.equal(d.action, "seek");
  assert.equal(d.toSec, 20); // 첫 구간 먼저
});

test("decide: 구간 없으면 null + prevSec 전진", () => {
  const d = SponsorSkipper.decide([], 5, 6, 200);
  assert.equal(d.action, null);
  assert.equal(d.prevSec, 6);
});

function fakePlayer({ status = "playing", isPlayStarting = false, paused = false, curSec = 0, duration = 200 } = {}) {
  const calls = { play: [], end: [] };
  return {
    currentTrack: { title: "t", duration },
    paused,
    isPlayStarting,
    audioPlayer: { state: { status } },
    getCurrentTime: () => curSec * 1000,
    play: async (_i, ms) => calls.play.push(ms),
    endCurrentTrackNaturally: (r) => calls.end.push(r),
    _calls: calls,
  };
}

test("_tick: isPlayStarting 중엔 발동 보류(재진입 방지)", async () => {
  const p = fakePlayer({ isPlayStarting: true, curSec: 5 });
  const sk = new SponsorSkipper(p);
  sk.segments = segs([0, 10]);
  sk._prevSec = -1;
  await sk._tick();
  assert.equal(p._calls.play.length, 0);
});

test("_tick: 실제 Playing 아니면 보류", async () => {
  const p = fakePlayer({ status: "buffering", curSec: 5 });
  const sk = new SponsorSkipper(p);
  sk.segments = segs([0, 10]);
  sk._prevSec = -1;
  await sk._tick();
  assert.equal(p._calls.play.length, 0);
});

test("_tick: Playing + 인트로 교차 → play(seek)", async () => {
  const p = fakePlayer({ curSec: 0.5, duration: 200 });
  const sk = new SponsorSkipper(p);
  sk.segments = segs([0, 8]);
  sk._prevSec = -1;
  await sk._tick();
  assert.deepEqual(p._calls.play, [8000]);
});

test("_tick: 아웃트로 → endCurrentTrackNaturally(핸들트랙엔드 직접호출 아님)", async () => {
  const p = fakePlayer({ curSec: 231, duration: 240 });
  const sk = new SponsorSkipper(p);
  sk.segments = segs([230, 240]);
  sk._prevSec = 229;
  await sk._tick();
  assert.deepEqual(p._calls.end, ["sponsorblock"]);
  assert.equal(p._calls.play.length, 0);
});

test("onPlayStart: 구간 있으면 워처 시작, 없으면 정지 (인터벌 핸들 검증)", () => {
  const fakePlayer = { currentTrack: { sponsor: { skipSegments: segs([0, 5]) }, duration: 100 }, paused: false, getCurrentTime: () => 0 };
  const sk = new SponsorSkipper(fakePlayer);
  sk.onPlayStart(0);
  assert.ok(sk._interval, "구간 있으면 인터벌 가동");
  assert.equal(sk._prevSec, -1);
  sk.stop();
  assert.equal(sk._interval, null);

  // 구간 없는 트랙
  fakePlayer.currentTrack = { sponsor: { skipSegments: [] }, duration: 100 };
  sk.onPlayStart(30);
  assert.equal(sk._interval, null, "구간 없으면 워처 미가동");
});
