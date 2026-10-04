// dashboard/src/utils/playback.ts — 재생 바와 서버 화면이 같이 쓰는 재생 규칙

import { test } from "node:test";
import assert from "node:assert/strict";
import { accepts, canRemove, canSkip, clockOf, moveTarget, onTrackOf, positionAt, previousEnabled, queueSize, reordered, retime, seekPosition, skipEnabled } from "../../../dashboard/src/utils/playback.ts";

test("받기: 같은 기동이면 차례가 지금 이상일 때만, 기동 표가 크면 받고 작으면 버린다", () => {
  const now = { boot: 200, seq: 10 };
  assert.equal(accepts(now, { boot: 200, seq: 11 }), true);
  assert.equal(accepts(now, { boot: 200, seq: 10 }), true);
  assert.equal(accepts(now, { boot: 200, seq: 9 }), false, "늦게 온 옛 응답");
  assert.equal(accepts(now, { boot: 300, seq: 1 }), true, "봇을 다시 켰다(차례가 처음부터)");
  assert.equal(accepts(now, { boot: 100, seq: 99 }), false, "옛 실행의 늦은 응답");
  assert.equal(accepts({}, { boot: 100, seq: 1 }), true, "처음 받는 상태");
  assert.equal(accepts(now, {}), true);
});

test("진행 계산: 받은 위치 + 지난 시간, 멈췄거나 곡이 없으면 그대로, 길이를 넘지 않는다", () => {
  const playing = { playing: true, paused: false, currentTrack: { currentTime: 30, duration: 100 } };
  assert.equal(positionAt(clockOf(playing, 1000), 6000), 35);
  assert.equal(positionAt(clockOf(playing, 1000), 999_000), 100, "길이에서 멈춘다");
  assert.equal(positionAt(clockOf({ ...playing, paused: true }, 1000), 6000), 30);
  assert.equal(positionAt(clockOf({ ...playing, playing: false }, 1000), 6000), 30, "재생 준비 중(유령 재생 없음)");
  assert.equal(positionAt(clockOf(null, 1000), 6000), 0);
  // 라이브는 길이가 0 이라 상한 없이 흐른다
  assert.equal(positionAt(clockOf({ playing: true, paused: false, currentTrack: { currentTime: 30, duration: 0 } }, 1000), 6000), 35);
  // 시계가 뒤로 가도 받은 위치보다 앞으로 가지 않는다
  assert.equal(positionAt(clockOf(playing, 5000), 1000), 30);
});

test("다시 재기: 멈추면 그 자리에 서고, 옮기면 옮긴 자리부터 흐른다", () => {
  const clock = clockOf({ playing: true, paused: false, currentTrack: { currentTime: 30, duration: 100 } }, 1000);
  const held = retime(clock, 6000, { running: false });
  assert.equal(positionAt(held, 20_000), 35);
  const moved = retime(clock, 6000, { at: 80 });
  assert.equal(positionAt(moved, 8000), 82);
});

test("건너뛰기 가능: 권한(조작 또는 지금 곡을 넣은 사람)과 넘길 곳(대기열 · 한곡 반복 · 자동재생)", () => {
  const base = { canControl: true, currentTrack: { requestedBy: { id: "u1" } }, userId: "u1", queueTotal: 0, loop: false as const, autoplay: false };
  assert.equal(skipEnabled(base), false, "넘길 곳이 없다");
  assert.equal(skipEnabled({ ...base, queueTotal: 3 }), true);
  assert.equal(skipEnabled({ ...base, loop: "track" }), true);
  assert.equal(skipEnabled({ ...base, autoplay: true }), true);
  assert.equal(skipEnabled({ ...base, queueTotal: 3, currentTrack: null }), false, "곡이 없다");
  assert.equal(canSkip({ ...base, canControl: false }), true, "지금 곡을 넣은 사람");
  assert.equal(canSkip({ ...base, canControl: false, userId: "u2" }), false);
  assert.equal(skipEnabled({ ...base, canControl: false, userId: "u2", queueTotal: 3 }), false);
  assert.equal(queueSize({ queue: [{}, {}] }), 2, "전체 수가 없으면 받은 목록 길이");
});

test("이전 곡 가능: 조작 권한과 기록, 한곡 반복이면 기록 없이도", () => {
  const base = { canControl: true, currentTrack: {}, hasPrevious: false, loop: false as const };
  assert.equal(previousEnabled(base), false);
  assert.equal(previousEnabled({ ...base, hasPrevious: true }), true);
  assert.equal(previousEnabled({ ...base, loop: "track" }), true);
  assert.equal(previousEnabled({ ...base, hasPrevious: true, canControl: false }), false);
});

test("빼기 권한: 조작 권한이 있거나 그 곡을 넣은 사람", () => {
  const s = { canControl: false, userId: "u1" };
  assert.equal(canRemove(s, { requestedBy: { id: "u1" } }), true);
  assert.equal(canRemove(s, { requestedBy: { id: "u2" } }), false);
  assert.equal(canRemove(s, { requestedBy: null }), false);
  assert.equal(canRemove({ ...s, canControl: true }, { requestedBy: null }), true);
});

test("지금 곡일 때만: 줄 번호가 있을 때만 싣는다", () => {
  assert.deepEqual(onTrackOf({ currentTrack: { entry: 7 } }), { onTrack: 7 });
  assert.deepEqual(onTrackOf({ currentTrack: { entry: null } }), {});
  assert.deepEqual(onTrackOf({ currentTrack: null }), {});
});

test("탐색 위치: 막대 위 가로 위치를 초로, 막대 밖은 양 끝", () => {
  const rect = { left: 100, width: 200 };
  assert.equal(seekPosition(200, rect, 300), 150);
  assert.equal(seekPosition(0, rect, 300), 0);
  assert.equal(seekPosition(999, rect, 300), 300);
  assert.equal(seekPosition(200, { left: 0, width: 0 }, 300), 0);
  assert.equal(seekPosition(200, rect, 0), 0, "길이를 모른다");
});

test("옮기기 요청: 놓은 틈 뒤의 줄 앞으로, 끝이면 맨 끝(받은 창이 전부일 때만)", () => {
  const q = [{ entry: 1 }, { entry: 2 }, { entry: 3 }, { entry: 4 }];
  assert.deepEqual(moveTarget(q, 0, 2, 4), { entry: 1, before: 3 });
  assert.deepEqual(moveTarget(q, 3, 0, 4), { entry: 4, before: 1 });
  assert.deepEqual(moveTarget(q, 1, 4, 4), { entry: 2, before: null });
  assert.equal(moveTarget(q, 1, 1, 4), "same");
  assert.equal(moveTarget(q, 1, 2, 4), "same");
  assert.equal(moveTarget(q, 1, 4, 10), "partial", "받은 창 뒤에 곡이 더 있다");
  assert.equal(moveTarget([{ entry: null }, { entry: 2 }], 0, 2, 2), "unknown");
  assert.equal(moveTarget([{ entry: 1 }, { entry: null }, { entry: 3 }], 2, 1, 3), "unknown", "앞에 둘 줄의 번호가 없다");
});

test("얹어 보이는 목록: 놓은 틈으로 옮긴 차례", () => {
  assert.deepEqual(reordered(["a", "b", "c", "d"], 0, 2), ["b", "a", "c", "d"]);
  assert.deepEqual(reordered(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(reordered(["a", "b", "c", "d"], 1, 4), ["a", "c", "d", "b"]);
});
