"use strict";

// src/trackState.js — 현재곡·대기열·기록 전이. 플레이어 없이 필드만 가진 객체로 검증한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const trackState = require("../src/trackState");

const t = (title) => ({ title });
const titles = (arr) => arr.map((x) => x.title);

function make({ current = null, queue = [], history = [], shuffle = false } = {}) {
  const p = { shuffle };
  trackState.init(p);
  trackState.restore(p, { current, queue: [...queue], history: [...history] });
  return p;
}

function withRandom(value, fn) {
  const real = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

test("init: 비어 있고 고정 없음", () => {
  const p = {};
  trackState.init(p);
  assert.deepEqual(p, { currentTrack: null, queue: [], previousTracks: [], nextFromFront: false });
});

test("enqueue: 뒤에 붙이기는 고정을 세우지 않는다", () => {
  const p = make({ current: t("A"), queue: [t("B")] });
  trackState.enqueue(p, [t("C"), t("D")]);
  assert.deepEqual(titles(p.queue), ["B", "C", "D"]);
  assert.equal(p.nextFromFront, false);
});

test("enqueue: 앞에 넣기는 재생 중일 때만 고정을 세운다", () => {
  const playing = make({ current: t("A"), queue: [t("B")] });
  trackState.enqueue(playing, [t("X")], { front: true });
  assert.deepEqual(titles(playing.queue), ["X", "B"]);
  assert.equal(playing.nextFromFront, true);

  const idle = make({ queue: [t("B")] });
  trackState.enqueue(idle, [t("X")], { front: true });
  assert.equal(idle.nextFromFront, false, "재생 중이 아니면 고정할 다음 전환이 없다");
});

test("shiftNext: 맨 앞을 현재곡으로, 비었으면 현재곡을 건드리지 않는다", () => {
  const p = make({ queue: [t("A"), t("B")], shuffle: true });
  assert.equal(trackState.shiftNext(p).title, "A", "셔플과 무관");
  assert.deepEqual(titles(p.queue), ["B"]);

  const empty = make({ current: t("Z") });
  assert.equal(trackState.shiftNext(empty), null);
  assert.equal(empty.currentTrack.title, "Z");
});

test("pickNext: 고정 → 맨 앞을 쓰고 고정을 푼다 (셔플이어도)", () => {
  const p = make({ queue: [t("A"), t("B"), t("C")], shuffle: true });
  p.nextFromFront = true;
  withRandom(0.99, () => trackState.pickNext(p));
  assert.equal(p.currentTrack.title, "A");
  assert.equal(p.nextFromFront, false);
});

test("pickNext: 셔플이면 무작위, 아니면 맨 앞", () => {
  const shuffled = make({ queue: [t("A"), t("B"), t("C")], shuffle: true });
  withRandom(0.99, () => trackState.pickNext(shuffled));
  assert.equal(shuffled.currentTrack.title, "C");
  assert.deepEqual(titles(shuffled.queue), ["A", "B"]);

  const plain = make({ queue: [t("A"), t("B")] });
  trackState.pickNext(plain);
  assert.equal(plain.currentTrack.title, "A");
});

test("retire: 기록에 남기고, 큐 반복이면 대기열 끝으로 — 현재곡은 그대로", () => {
  const A = t("A");
  const p = make({ current: A, queue: [t("B")] });
  trackState.retire(p, A, { requeue: true });
  assert.deepEqual(titles(p.previousTracks), ["A"]);
  assert.deepEqual(titles(p.queue), ["B", "A"]);
  assert.equal(p.currentTrack, A, "다음 곡이 덮기 전까지 비우지 않는다");
});

test("retire: 기록은 상한을 넘으면 가장 오래된 것부터 버린다", () => {
  const p = make();
  for (let i = 0; i < trackState.HISTORY_MAX + 3; i++) trackState.retire(p, t(`t${i}`));
  assert.equal(p.previousTracks.length, trackState.HISTORY_MAX);
  assert.equal(p.previousTracks[0].title, "t3");
});

test("rewind: 이전 곡을 맨 앞에, 중단된 현재곡을 그 뒤에 두고 고정", () => {
  const p = make({ current: t("C"), queue: [t("D")], history: [t("A"), t("B")] });
  assert.equal(trackState.rewind(p).title, "B");
  assert.deepEqual(titles(p.queue), ["B", "C", "D"]);
  assert.deepEqual(titles(p.previousTracks), ["A"]);
  assert.equal(p.nextFromFront, true);

  const none = make({ current: t("C"), queue: [t("D")] });
  assert.equal(trackState.rewind(none), null);
  assert.deepEqual(titles(none.queue), ["D"], "기록이 없으면 아무것도 바꾸지 않는다");
});

test("promote → cancelPromote: 원래 순서와 고정 상태로 되돌아온다", () => {
  const p = make({ current: t("X"), queue: [t("A"), t("B"), t("C")] });
  assert.equal(trackState.promote(p, 2).title, "C");
  assert.deepEqual(titles(p.queue), ["C", "A", "B"]);
  assert.equal(p.nextFromFront, true);

  trackState.cancelPromote(p, 2);
  assert.deepEqual(titles(p.queue), ["A", "B", "C"]);
  assert.equal(p.nextFromFront, false);
});

test("removeAt·move: 범위 밖이면 null이고 아무것도 바꾸지 않는다", () => {
  const p = make({ queue: [t("A"), t("B"), t("C")] });
  assert.equal(trackState.removeAt(p, 3), null);
  assert.equal(trackState.move(p, 0, 3), null);
  assert.deepEqual(titles(p.queue), ["A", "B", "C"]);

  assert.equal(trackState.move(p, 0, 2).title, "A");
  assert.deepEqual(titles(p.queue), ["B", "C", "A"]);
  assert.equal(trackState.removeAt(p, 1).title, "C");
  assert.deepEqual(titles(p.queue), ["B", "A"]);
});

test("shuffle: 구성원은 그대로다", () => {
  const p = make({ queue: ["A", "B", "C", "D", "E"].map(t) });
  trackState.shuffle(p);
  assert.deepEqual(titles(p.queue).sort(), ["A", "B", "C", "D", "E"]);
});

test("clearQueue: 비운 개수를 돌려주고 현재곡·기록은 남긴다", () => {
  const p = make({ current: t("X"), queue: [t("A"), t("B")], history: [t("H")] });
  assert.equal(trackState.clearQueue(p), 2);
  assert.deepEqual(p.queue, []);
  assert.equal(p.currentTrack.title, "X");
  assert.equal(p.previousTracks.length, 1);
});

test("reset: 기록은 요청할 때만 비운다", () => {
  const keep = make({ current: t("X"), queue: [t("A")], history: [t("H")] });
  keep.nextFromFront = true;
  trackState.reset(keep);
  assert.equal(keep.currentTrack, null);
  assert.deepEqual(keep.queue, []);
  assert.equal(keep.nextFromFront, false);
  assert.equal(keep.previousTracks.length, 1);

  const all = make({ history: [t("H")] });
  trackState.reset(all, { history: true });
  assert.deepEqual(all.previousTracks, []);
});

test("restore: 기록이 상한보다 길면 최근 것만 남긴다", () => {
  const history = Array.from({ length: trackState.HISTORY_MAX + 5 }, (_, i) => t(`h${i}`));
  const p = make({ current: t("X"), queue: [t("A")], history });
  assert.equal(p.previousTracks.length, trackState.HISTORY_MAX);
  assert.equal(p.previousTracks.at(-1).title, `h${trackState.HISTORY_MAX + 4}`);
});

test("바꾼 뒤 한 번씩 알린다 — 세션 저장이 메모리를 따라가는 통로", () => {
  const calls = [];
  const brief = (a) => (Array.isArray(a) ? titles(a) : (a?.title ?? a));
  const sink = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) =>
          calls.push([name, ...args.map(brief)]),
    },
  );
  const p = make({ current: t("X"), queue: [t("A"), t("B"), t("C")], history: [t("H")] });
  p.trackSink = sink;

  trackState.enqueue(p, [t("D")]);
  trackState.enqueue(p, [t("E")], { front: true });
  trackState.shiftNext(p);
  trackState.pickNext(p); // 앞에 넣은 고정이 남아 있다 → 맨 앞
  p.shuffle = true;
  withRandom(0.99, () => trackState.pickNext(p));
  trackState.retire(p, p.currentTrack, { requeue: true });
  trackState.removeAt(p, 99);
  trackState.removeAt(p, 0);
  trackState.move(p, 0, 1);
  trackState.shuffle(p);
  trackState.rewind(p);
  trackState.promote(p, 1);
  trackState.cancelPromote(p, 1);
  trackState.clearQueue(p);
  trackState.setCurrent(p, null);
  trackState.reset(p, { history: true });
  trackState.rewind(p);

  assert.deepEqual(calls, [["onEnqueue", ["D"], false], ["onEnqueue", ["E"], true], ["onTake", 0], ["onTake", 0], ["onTake", 2], ["onRetire", "D", true], ["onRemoveAt", 0], ["onMove", 0, 1], ["onReplace"], ["onReplace"], ["onReplace"], ["onReplace"], ["onClearQueue"], ["onSetCurrent", null], ["onReset", true]]);
});
