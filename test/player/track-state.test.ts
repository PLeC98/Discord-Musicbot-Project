// src/player/track-state.ts — 현재곡·대기열·기록 전이. 플레이어 없이 필드만 가진 객체로 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as trackState from "../../src/player/track-state.ts";
import type { Tracks, TrackSink } from "../../src/player/track-state.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake } from "../helpers/fake.ts";

// 곡 가짜. 요청 열쇠는 비워 둔다(큐 반복의 사본 찾기가 열쇠를 볼 때만 준다)
const t = (title: string, extra: Partial<QueuedTrack> = {}): QueuedTrack => ({ title, duration: 0, platform: "youtube", pageUrl: "", requestKey: "", ...extra });
const titles = (arr: QueuedTrack[]) => arr.map((x) => x.title);

function make({ current = null, queue = [], history = [] }: { current?: QueuedTrack | null; queue?: QueuedTrack[]; history?: QueuedTrack[] } = {}) {
  const p: Tracks = { currentTrack: null, queue: [], previousTracks: [], loop: false };
  trackState.init(p);
  trackState.restore(p, { current, queue: [...queue], history: [...history] });
  return p;
}

test("init: 비어 있다", () => {
  const p = fake<Pick<Tracks, "currentTrack" | "queue" | "previousTracks">>({}); // init 이 칸을 채운다
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

test("insertAfter: 앵커 곡 바로 뒤에, 그 곡이 없으면 맨 앞에", () => {
  const p = make({ current: t("X"), queue: ["a", "b", "c"].map((id) => t(id.toUpperCase(), { id })) });
  trackState.insertAfter(p, "b", [t("N1"), t("N2")]);
  assert.deepEqual(titles(p.queue), ["A", "B", "N1", "N2", "C"]);

  trackState.insertAfter(p, "gone", [t("M")]);
  assert.equal(p.queue[0].title, "M");
});

test("shiftNext: 맨 앞을 현재곡으로, 비었으면 현재곡을 건드리지 않는다", () => {
  const p = make({ queue: [t("A"), t("B")] });
  assert.equal(trackState.shiftNext(p)?.title, "A");
  assert.deepEqual(titles(p.queue), ["B"]);

  const empty = make({ current: t("Z") });
  assert.equal(trackState.shiftNext(empty), null);
  assert.equal(empty.currentTrack?.title, "Z");
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
  assert.equal(trackState.rewind(p)?.title, "B");
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

  assert.equal(trackState.move(p, 0, 2)?.title, "A");
  assert.deepEqual(titles(p.queue), ["B", "C", "A"]);
  assert.equal(trackState.removeAt(p, 1)?.title, "C");
  assert.deepEqual(titles(p.queue), ["B", "A"]);
});

test("shuffle: 구성원은 그대로다", () => {
  const p = make({ queue: ["A", "B", "C", "D", "E"].map((title) => t(title)) });
  trackState.shuffle(p);
  assert.deepEqual(titles(p.queue).sort(), ["A", "B", "C", "D", "E"]);
});

test("clearQueue: 비운 개수를 돌려주고 현재곡·기록은 남긴다", () => {
  const p = make({ current: t("X"), queue: [t("A"), t("B")], history: [t("H")] });
  assert.equal(trackState.clearQueue(p), 2);
  assert.deepEqual(p.queue, []);
  assert.equal(p.currentTrack?.title, "X");
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
  assert.equal(p.previousTracks.at(-1)?.title, `h${trackState.HISTORY_MAX + 4}`);
});

test("바꾼 뒤 한 번씩 알린다 — 세션 저장이 메모리를 따라가는 통로", () => {
  const calls: unknown[][] = [];
  const brief = (a: unknown) => (Array.isArray(a) ? titles(a) : ((a as QueuedTrack | null)?.title ?? a));
  const sink = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args: unknown[]) =>
          calls.push([name, ...args.map(brief)]),
    },
  );
  const p = make({ current: t("X"), queue: [t("A"), t("B"), t("C")], history: [t("H")] });
  p.trackSink = fake<TrackSink>(sink); // 부른 이름을 다 적는다

  trackState.enqueue(p, [t("D")]);
  trackState.enqueue(p, [t("E")], { front: true });
  trackState.shiftNext(p);
  assert.ok(p.currentTrack);
  trackState.retire(p, t("F"), { requeue: true }); // 반복 중에 끝난 곡 F: 기록과 대기열 끝 양쪽에(지금 곡 E 와는 다른 곡이라 rewind 가 건너뛰지 않는다)
  trackState.removeAt(p, 99);
  trackState.removeAt(p, 0);
  trackState.move(p, 0, 1);
  trackState.rewind(p); // 큐 반복으로 끝에 들어간 F(3번째)를 빼고 앞으로 — 현재곡 E 는 그 뒤에
  trackState.rewindRing(p); // 대기열 [F, E, C, B, D] 의 맨 끝(D, 4번째)을 앞으로. 기록은 그대로
  trackState.shuffle(p);
  trackState.clearQueue(p);
  trackState.setCurrent(p, null);
  trackState.reset(p, { history: true });
  trackState.rewind(p);
  trackState.restore(p, { current: t("R") }, { persisted: true }); // 저장소에서 읽은 그대로 — 알리지 않는다

  assert.deepEqual(calls, [["onEnqueue", ["D"], false], ["onEnqueue", ["E"], true], ["onTake", 0], ["onRetire", "F", true], ["onRemoveAt", 0], ["onMove", 0, 1], ["onRewind", "F", 3, "E", true], ["onRewind", "D", 4, "E", false], ["onReplace"], ["onClearQueue"], ["onSetCurrent", null], ["onReset", true]]);
});

const song = (title: string) => t(title, { requestKey: `https://y/${title}` });

test("rewind: 반복을 끄기 전에 대기열 끝으로 돌아간 사본은 빼고 앞으로 가져온다 — 곡 수가 그대로다", () => {
  const A = song("A");
  const p = make({ current: song("B"), queue: [song("C")] });
  trackState.retire(p, A, { requeue: true }); // 반복 중에 A가 끝나 기록과 대기열 끝 양쪽에 들어간 뒤 반복을 껐다

  trackState.rewind(p);
  assert.deepEqual(titles(p.queue), ["A", "B", "C"], "구 코드는 A가 앞과 끝에 두 번 있었다");
});

test("rewindRing: 대기열 반복의 이전 곡은 대기열 맨 끝 곡이다. 기록은 건드리지 않는다(복원 뒤처럼 서로 다른 객체여도 곡 수가 그대로)", () => {
  const p = make({ current: song("B"), queue: [song("C"), song("A")], history: [song("A")] });
  trackState.rewindRing(p);
  assert.deepEqual(titles(p.queue), ["A", "B", "C"]);
  assert.deepEqual(titles(p.previousTracks), ["A"]);
  assert.equal(trackState.rewindRing(make({ current: song("B"), queue: [] })), null, "대기열이 비면 꺼낼 곡이 없다");
});

test("rewind: 대기열 반복에서 이전 곡(고리)을 누른 뒤 반복을 끄고 또 누르면, 기록 끝에 남은 지금 곡을 건너뛰고 그 앞 곡으로 간다 — 곡이 늘지 않는다", () => {
  const [A, B, C, D] = ["A", "B", "C", "D"].map((x) => song(x));
  const p = make({ current: A, queue: [B, C, D] });
  p.loop = "queue";
  const next = (reason: string) => {
    if (reason !== "previous") trackState.retire(p, p.currentTrack!, { requeue: p.loop === "queue" });
    trackState.shiftNext(p);
  };
  next("skip");
  next("skip"); // 지금 C, 기록 A · B
  trackState.rewindRing(p);
  next("previous"); // 지금 B(고리로 되돌림), 기록은 그대로 A · B
  p.loop = false;
  assert.equal(trackState.rewind(p), A, "기록 끝의 B 는 지금 곡이라 건너뛰고 A");
  next("previous");
  assert.equal(p.currentTrack, A);
  assert.deepEqual(titles(p.queue), ["B", "C", "D"]);
  assert.deepEqual(titles(p.previousTracks), []);
});

test("rewind: 반복이 아니면 같은 곡이 대기열에 있어도 건드리지 않는다 — 사용자가 일부러 넣은 곡이다", () => {
  const p = make({ current: song("B"), queue: [song("A")], history: [song("A")] });
  trackState.rewind(p);
  assert.deepEqual(titles(p.queue), ["A", "B", "A"]);
});

// ── 대기열 줄 번호 ─────────────────────────────────────────────────────
// 대시보드가 빼기 · 옮기기 · "지금 곡이 이것일 때만"을 순번이 아니라 이 번호로 가리킨다

test("줄 번호: 들어오는 다섯 길(지금 곡 · 넣기 · 자동재생 앞 · 뒤에 잇기 · 되살리기)에서 찍고, 서로 다르다", () => {
  const p = make({ current: t("R0"), queue: [t("R1")], history: [t("R2")] });
  trackState.setCurrent(p, t("C"));
  trackState.enqueue(p, [t("E1"), t("E2")]);
  trackState.enqueue(p, [t("F")], { front: true });
  trackState.enqueue(p, [t("Auto", { autoplay: true })]);
  trackState.enqueueAheadOfAutoplay(p, [t("A")]);
  trackState.insertAfter(p, undefined, [t("I")]);
  const all = [p.currentTrack, ...p.queue, ...p.previousTracks].filter((x): x is QueuedTrack => !!x);
  const entries = all.map((x) => x.entry);
  assert.ok(
    entries.every((e) => Number.isInteger(e)),
    JSON.stringify(entries),
  );
  assert.equal(new Set(entries).size, entries.length, "겹치지 않는다");
});

test("줄 번호: 옮기기 · 섞기 · 되감기 · 반복으로 끝에 돌리기는 같은 번호, 복사해 넣은 곡은 새 번호", () => {
  const p = make();
  const a = t("A");
  const b = t("B");
  trackState.enqueue(p, [a, b]);
  const [ea, eb] = [a.entry, b.entry];
  trackState.move(p, 0, 1);
  trackState.shuffle(p, () => 0);
  trackState.shiftNext(p);
  const first = p.currentTrack as QueuedTrack;
  trackState.retire(p, first, { requeue: true });
  assert.deepEqual(new Set([...p.queue, first].map((x) => x.entry)), new Set([ea, eb]));

  const copy = { ...a };
  assert.equal(copy.entry, undefined, "복사본에는 번호가 따라가지 않는다(열거되지 않는 칸)");
  trackState.enqueue(p, [copy]);
  assert.ok(copy.entry !== undefined && copy.entry !== ea);
  assert.deepEqual(Object.keys(copy).includes("entry"), false, "객체 비교 · JSON 에는 나오지 않는다");
});

test("줄 번호: 쉬던 플레이어의 첫 곡(대기열을 거치지 않는다)도 대기열 반복으로 끝에 돌아가면 번호가 있다", () => {
  const p = make();
  const first = t("첫 곡");
  trackState.setCurrent(p, first);
  trackState.retire(p, first, { requeue: true });
  assert.ok(Number.isInteger(p.queue[0].entry));
});

test("줄 번호: 이미 번호를 가진 곡(저장된 번호로 되살린 곡)은 그 번호를 지킨다", () => {
  const kept = Object.defineProperty(t("저장된 곡"), "entry", { value: 500, enumerable: false });
  const p = make({ queue: [kept] });
  assert.equal(p.queue[0].entry, 500);
});

test("줄 번호: 되살린 번호보다 뒤에서 센다(봇을 다시 켜도 새 곡이 되살린 곡의 번호와 겹치지 않는다)", () => {
  const p = make();
  const high = 1_000_000_000;
  trackState.restore(p, { current: Object.defineProperty(t("되살린 곡"), "entry", { value: high, enumerable: false }) }, { persisted: true });
  trackState.enqueue(p, [t("새 곡")]);
  assert.equal(p.currentTrack?.entry, high);
  assert.ok((p.queue[0].entry ?? 0) > high);
});
