"use strict";

// src/MusicPlayer.js — 반복 모드 × 트랙 전이(자연 종료/스킵/이전곡) 계약
// 회귀 대상 3종:
//  1. 한곡 반복 중 스킵이 대기열을 진행시킴 (기대: 현재 곡 재시작, 대기열 불변)
//  2. 큐 반복 중 이전곡을 누르면 중단곡이 대기열에 복제됨 (3곡 → 5곡)
//  3. 한곡 반복 중 이전곡을 누르면 곡이 증식하며 두 곡이 번갈아 재생됨
// handleTrackEnd/previous를 프로토타입 호출 — 실 오디오/연결 없이 상태 전이만 검증.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const MusicPlayer = require("../src/MusicPlayer");

const handleTrackEnd = MusicPlayer.prototype.handleTrackEnd;
const previous = MusicPlayer.prototype.previous;

function makeTrack(title, duration = 100) {
  return { title, url: `https://y/${title}`, duration };
}

function makePlayer({ loop = false, current = null, queue = [], history = [] } = {}) {
  return {
    isTransitioning: false,
    trackTimer: null,
    currentTrack: current,
    // playbackDuration = 곡 길이 전체 → "자연 종료"로 판정 (endedUnexpectedly 아님)
    resource: current ? { playbackDuration: (current.duration || 0) * 1000 } : null,
    currentTrackStartOffsetMs: 0,
    lastPlaybackPosition: 0,
    currentTrackRetries: 0,
    previousTracks: history,
    currentDownloadedFile: null,
    loop,
    queue,
    shuffle: false,
    nextFromFront: false,
    autoplay: false,
    startTime: null,
    pausedTime: 0,
    expectedTrackEndTs: null,
    currentTrackCache: null,
    skipRequested: false,
    stopRequested: false,
    pendingEndReason: null,
    guild: { id: "g1", client: null },
    played: [],
    releaseAudioProtection() {},
    scheduleStatePersist() {},
    audioPlayer: { stop() {} },
    async play(_, ms) {
      this.played.push({ title: this.currentTrack?.title, ms });
      this.resource = { playbackDuration: 0 };
    },
  };
}

const titles = (arr) => arr.map((t) => t.title);

// ── 한곡 반복 ─────────────────────────────────────────────────

test("한곡 반복: 자연 종료 → 같은 곡 처음부터, 대기열·기록 불변", async () => {
  const A = makeTrack("A");
  const p = makePlayer({ loop: "track", current: A, queue: [makeTrack("B"), makeTrack("C")] });

  await handleTrackEnd.call(p, "idle");

  assert.deepEqual(p.played, [{ title: "A", ms: 0 }]);
  assert.equal(p.currentTrack, A);
  assert.deepEqual(titles(p.queue), ["B", "C"], "대기열 불변");
  assert.equal(p.previousTracks.length, 0, "기록 불변");
});

test("한곡 반복: 스킵도 현재 곡 재시작 — 대기열을 진행시키지 않음 (버그 1 회귀)", async () => {
  const A = makeTrack("A");
  const p = makePlayer({ loop: "track", current: A, queue: [makeTrack("B")] });

  await handleTrackEnd.call(p, "skip");

  assert.deepEqual(p.played, [{ title: "A", ms: 0 }], "구 코드는 B로 진행했음");
  assert.deepEqual(titles(p.queue), ["B"]);
});

test("한곡 반복: 반복 재생이 이전 곡 기록을 오염시키지 않음 (증식 씨앗 제거)", async () => {
  const p = makePlayer({ loop: "track", current: makeTrack("A"), queue: [] });

  for (let i = 0; i < 3; i++) await handleTrackEnd.call(p, "idle");

  assert.equal(p.previousTracks.length, 0, "구 코드는 반복마다 A가 기록에 쌓였음");
});

test("한곡 반복 + 이전곡: 현재 곡 재시작, 곡 수 불변 (버그 3 회귀 — 구 코드는 곡이 증식)", async () => {
  const A = makeTrack("A");
  const p = makePlayer({ loop: "track", current: A, queue: [makeTrack("B")], history: [] });

  assert.equal(previous.call(p), true, "기록이 비어 있어도 재시작으로 동작");
  assert.deepEqual(titles(p.queue), ["B"], "previous()가 대기열을 건드리지 않음");
  assert.equal(p.pendingEndReason, "previous");

  await handleTrackEnd.call(p, "previous");
  assert.deepEqual(p.played, [{ title: "A", ms: 0 }]);
  assert.equal(p.currentTrack, A);
  assert.deepEqual(titles(p.queue), ["B"]);
  assert.equal(p.previousTracks.length, 0);
});

test("한곡 반복 + 대기열 점프(jump): 재시작이 아니라 선택한 곡으로 이동", async () => {
  const [A, B, C] = ["A", "B", "C"].map((t) => makeTrack(t));
  // jump 핸들러가 선택곡 C를 맨 앞으로 옮기고 nextFromFront를 세운 상태
  const p = makePlayer({ loop: "track", current: A, queue: [C, B] });
  p.nextFromFront = true;

  await handleTrackEnd.call(p, "jump");

  assert.equal(p.currentTrack, C, "한곡 반복이어도 점프는 대기열 진행");
  assert.deepEqual(titles(p.queue), ["B"]);
  assert.deepEqual(titles(p.previousTracks), ["A"], "떠난 곡은 기록에 들어감");
});

test("skip(reason): 기본은 'skip', 점프는 'jump'를 종료 사유로 세움", () => {
  const skip = MusicPlayer.prototype.skip;
  const p = makePlayer({ current: makeTrack("A") });
  skip.call(p);
  assert.equal(p.pendingEndReason, "skip");
  skip.call(p, "jump");
  assert.equal(p.pendingEndReason, "jump");
});

// ── 큐 반복 ───────────────────────────────────────────────────

test("큐 반복 + 이전곡: 복제 없이 총 곡 수 보존 (버그 2 회귀 — 구 코드는 3곡이 5곡으로)", async () => {
  const [A, B, C, D, E] = ["A", "B", "C", "D", "E"].map((t) => makeTrack(t));
  const p = makePlayer({ loop: "queue", current: C, queue: [D, E], history: [A, B] });

  previous.call(p);
  assert.deepEqual(titles(p.queue), ["B", "C", "D", "E"], "이전곡 B가 앞에, 중단곡 C가 그 뒤에");

  await handleTrackEnd.call(p, "previous");

  assert.equal(p.currentTrack, B);
  assert.deepEqual(titles(p.queue), ["C", "D", "E"], "중단곡 C는 한 번만 존재 — 큐 반복 재삽입 없음");
  assert.deepEqual(titles(p.previousTracks), ["A"], "끝나지 않은 C는 기록에 안 들어감");
});

test("큐 반복: 자연 종료/스킵은 끝난 곡을 대기열 끝으로 (기존 동작 보존)", async () => {
  const A = makeTrack("A");
  const B = makeTrack("B");
  const p = makePlayer({ loop: "queue", current: A, queue: [B] });

  await handleTrackEnd.call(p, "idle");

  assert.equal(p.currentTrack, B);
  assert.deepEqual(titles(p.queue), ["A"], "끝난 A가 대기열 끝으로 순환");
  assert.deepEqual(titles(p.previousTracks), ["A"]);
});

// ── 반복 없음 ─────────────────────────────────────────────────

test("반복 없음: 스킵은 다음 곡 진행 + 기록 (기존 동작 보존)", async () => {
  const A = makeTrack("A");
  const B = makeTrack("B");
  const p = makePlayer({ current: A, queue: [B] });

  await handleTrackEnd.call(p, "skip");

  assert.equal(p.currentTrack, B);
  assert.deepEqual(titles(p.queue), []);
  assert.deepEqual(titles(p.previousTracks), ["A"]);
});

test("반복 없음: 이전곡 연타 체인 — 중복 없이 기록을 거슬러 올라감", async () => {
  const [A, B, C, D] = ["A", "B", "C", "D"].map((t) => makeTrack(t));
  const p = makePlayer({ current: C, queue: [D], history: [A, B] });

  previous.call(p);
  await handleTrackEnd.call(p, "previous");
  assert.equal(p.currentTrack, B);
  assert.deepEqual(titles(p.queue), ["C", "D"]);

  previous.call(p);
  await handleTrackEnd.call(p, "previous");
  assert.equal(p.currentTrack, A);
  assert.deepEqual(titles(p.queue), ["B", "C", "D"]);
  assert.equal(p.previousTracks.length, 0, "기록 소진 — 각 곡은 어디에도 중복되지 않음");
});
