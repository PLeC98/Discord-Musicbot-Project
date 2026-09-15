"use strict";

// src/trackState.js — 현재곡·대기열·기록 전이. 플레이어 없이 필드만 가진 객체로 검증한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const trackState = require("../src/trackState");

const t = (title) => ({ title });
const titles = (arr) => arr.map((x) => x.title);

function make({ current = null, queue = [], history = [] } = {}) {
  const p = {};
  trackState.init(p);
  trackState.restore(p, { current, queue: [...queue], history: [...history] });
  return p;
}

test("init: 비어 있다", () => {
  const p = {};
  trackState.init(p);
  assert.deepEqual(p, { currentTrack: null, queue: [], previousTracks: [] });
});

test("enqueue: 뒤에 붙이거나 앞에 넣는다", () => {
  const p = make({ current: t("A"), queue: [t("B")] });
  trackState.enqueue(p, [t("C"), t("D")]);
  assert.deepEqual(titles(p.queue), ["B", "C", "D"]);
  trackState.enqueue(p, [t("X"), t("Y")], { front: true });
  assert.deepEqual(titles(p.queue), ["X", "Y", "B", "C", "D"]);
});

test("shiftNext: 맨 앞을 현재곡으로, 비었으면 현재곡을 건드리지 않는다", () => {
  const p = make({ queue: [t("A"), t("B")] });
  assert.equal(trackState.shiftNext(p).title, "A");
  assert.deepEqual(titles(p.queue), ["B"]);

  const empty = make({ current: t("Z") });
  assert.equal(trackState.shiftNext(empty), null);
  assert.equal(empty.currentTrack.title, "Z");
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

test("rewind: 이전 곡을 맨 앞에, 중단된 현재곡을 그 뒤에 둔다", () => {
  const p = make({ current: t("C"), queue: [t("D")], history: [t("A"), t("B")] });
  assert.equal(trackState.rewind(p).title, "B");
  assert.deepEqual(titles(p.queue), ["B", "C", "D"]);
  assert.deepEqual(titles(p.previousTracks), ["A"]);

  const none = make({ current: t("C"), queue: [t("D")] });
  assert.equal(trackState.rewind(none), null);
  assert.deepEqual(titles(none.queue), ["D"], "기록이 없으면 아무것도 바꾸지 않는다");
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
  trackState.reset(keep);
  assert.equal(keep.currentTrack, null);
  assert.deepEqual(keep.queue, []);
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
  trackState.retire(p, p.currentTrack, { requeue: true });
  trackState.removeAt(p, 99);
  trackState.removeAt(p, 0);
  trackState.move(p, 0, 1);
  trackState.rewind(p); // 큐 반복으로 끝에 들어간 E(3번째)를 빼고 앞으로 — 현재곡 E도 그 뒤에
  trackState.shuffle(p);
  trackState.clearQueue(p);
  trackState.setCurrent(p, null);
  trackState.reset(p, { history: true });
  trackState.rewind(p);
  trackState.restore(p, { current: t("R") }, { persisted: true }); // 저장소에서 읽은 그대로 — 알리지 않는다

  assert.deepEqual(calls, [["onEnqueue", ["D"], false], ["onEnqueue", ["E"], true], ["onTake", 0], ["onRetire", "E", true], ["onRemoveAt", 0], ["onMove", 0, 1], ["onRewind", "E", 3, "E"], ["onReplace"], ["onClearQueue"], ["onSetCurrent", null], ["onReset", true]]);
});

const song = (title) => ({ title, url: `https://y/${title}` });

test("rewind: 큐 반복으로 대기열 끝에 들어간 사본은 빼고 앞으로 가져온다 — 곡 수가 그대로다", () => {
  const A = song("A");
  const p = make({ current: song("B"), queue: [song("C")] });
  p.loop = "queue";
  trackState.retire(p, A, { requeue: true }); // A가 끝나 기록과 대기열 끝 양쪽에 들어간 상태

  trackState.rewind(p);
  assert.deepEqual(titles(p.queue), ["A", "B", "C"], "구 코드는 A가 앞과 끝에 두 번 있었다");
});

test("rewind: 복원 뒤처럼 기록과 대기열이 서로 다른 객체여도 큐 반복이면 주소로 사본을 찾는다", () => {
  const p = make({ current: song("B"), queue: [song("C"), song("A")], history: [song("A")] });
  p.loop = "queue";
  trackState.rewind(p);
  assert.deepEqual(titles(p.queue), ["A", "B", "C"]);
});

test("rewind: 반복이 아니면 같은 곡이 대기열에 있어도 건드리지 않는다 — 사용자가 일부러 넣은 곡이다", () => {
  const p = make({ current: song("B"), queue: [song("A")], history: [song("A")] });
  trackState.rewind(p);
  assert.deepEqual(titles(p.queue), ["A", "B", "A"]);
});
