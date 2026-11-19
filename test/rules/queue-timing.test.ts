// src/rules/queue-timing.ts: 대기열 곡마다 시작까지의 시간, 아는 길이의 합, 다 끝나는 시각

import { test } from "node:test";
import assert from "node:assert/strict";
import { queueTiming } from "../../src/rules/queue-timing.ts";

const NOW = 1_000_000;
const song = (duration: number, isLive = false) => ({ duration, isLive });
const playing = (over: Partial<Parameters<typeof queueTiming>[0]> = {}) => ({ track: song(200), positionSec: 50, paused: false, loop: false as const, ...over });

test("지금 곡의 남은 시간부터 앞 곡들의 길이를 더한다. 끝나는 시각은 마지막 곡의 끝", () => {
  const t = queueTiming(playing(), [song(100), song(60), song(30)], NOW);
  assert.deepEqual(t.startsIn, [150, 250, 310]);
  assert.equal(t.totalSec, 190);
  assert.equal(t.endsAtMs, NOW + 340_000);
});

test("길이를 모르는 곡(라이브, 길이 0) 뒤로는 모른다. 합은 아는 길이만, 끝나는 시각은 모른다", () => {
  const t = queueTiming(playing(), [song(100), song(0), song(30), song(500, true), song(20)], NOW);
  assert.deepEqual(t.startsIn, [150, 250, null, null, null]);
  assert.equal(t.totalSec, 150);
  assert.equal(t.endsAtMs, null);
});

test("지금 곡의 남은 시간을 모르면(곡 없음, 라이브, 길이 모름) 모두 모른다", () => {
  for (const now of [playing({ track: null }), playing({ track: song(0) }), playing({ track: song(300, true) })]) {
    const t = queueTiming(now, [song(100), song(60)], NOW);
    assert.deepEqual(t.startsIn, [null, null]);
    assert.equal(t.totalSec, 160);
    assert.equal(t.endsAtMs, null);
  }
});

test("멈춰 있거나 한 곡 반복이면 시작 시간, 끝나는 시각 모두 모른다. 대기열 반복, 자동재생이면 끝나는 시각만 모른다", () => {
  for (const now of [playing({ paused: true }), playing({ loop: "track" })]) {
    const t = queueTiming(now, [song(100)], NOW);
    assert.deepEqual([t.startsIn, t.endsAtMs], [[null], null]);
  }
  const loop = queueTiming(playing({ loop: "queue" }), [song(100), song(60)], NOW);
  assert.deepEqual([loop.startsIn, loop.endsAtMs], [[150, 250], null]);
  const autoplay = queueTiming(playing({ autoplay: true }), [song(100), song(60)], NOW);
  assert.deepEqual([autoplay.startsIn, autoplay.endsAtMs], [[150, 250], null], "자동재생이면 곡이 이어진다");
});

test("위치가 길이를 넘어도(끝나는 중) 시작까지는 0 부터", () => {
  assert.deepEqual(queueTiming(playing({ positionSec: 230 }), [song(100)], NOW).startsIn, [0]);
});
