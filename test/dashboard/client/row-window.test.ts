// dashboard/src/composables/row-window.ts · utils/reply-order.ts · pointer-reorder 의 높이 계산: 긴 목록을 보이는 만큼만 받고 그리는 가상 스크롤, 응답 순서 처리, 드래그 거리

import { test } from "node:test";
import assert from "node:assert/strict";
import { aroundRows, covers, drawnRows, slotsOf, visibleRows } from "../../../dashboard/src/composables/row-window.ts";
import { boundedDy, heightTarget } from "../../../dashboard/src/composables/pointer-reorder.ts";
import { replyOrder } from "../../../dashboard/src/utils/reply-order.ts";
import { LIST_WINDOW_MAX } from "../../../src/dashboard/contract/admin.ts";

test("보이는 행: 스크롤 위치 · 영역 높이로, 끝은 필터링된 수까지. 높이가 0 이면 계산하지 않는다", () => {
  assert.deepEqual(visibleRows(0, 312, 48, 100), { first: 0, last: 7 }, "6.5줄이 보이면 일곱째 행까지");
  assert.deepEqual(visibleRows(480, 312, 48, 100), { first: 10, last: 17 });
  assert.deepEqual(visibleRows(4600, 312, 48, 100), { first: 95, last: 100 });
  assert.deepEqual(visibleRows(0, 312, 48, 3), { first: 0, last: 3 });
  assert.equal(visibleRows(0, 0, 48, 100), null);
});

test("받을 구간: 위아래 한 화면씩 오버스캔, 맨 위 · 맨 끝에서 잘린다, 상한까지", () => {
  assert.deepEqual(aroundRows({ first: 10, last: 17 }, 100), { from: 3, count: 21 });
  assert.deepEqual(aroundRows({ first: 0, last: 7 }, 100), { from: 0, count: 14 });
  assert.deepEqual(aroundRows({ first: 95, last: 100 }, 100), { from: 90, count: 10 });
  assert.deepEqual(aroundRows({ first: 0, last: 0 }, 0), { from: 0, count: 0 });
  assert.equal(aroundRows({ first: 500, last: 800 }, 5000).count, LIST_WINDOW_MAX);
});

test("받은 구간이 보이는 행을 덮나: 끝에서 짧게 받은 구간도 덮는다", () => {
  assert.equal(covers({ from: 0, count: 30 }, { first: 10, last: 17 }), true);
  assert.equal(covers({ from: 0, count: 30 }, { first: 25, last: 32 }), false);
  assert.equal(covers({ from: 12, count: 30 }, { first: 10, last: 17 }), false);
  assert.equal(covers({ from: 90, count: 10 }, { first: 95, last: 100 }), true);
  assert.equal(covers({ from: 0, count: 0 }, { first: 0, last: 0 }), true, "빈 목록");
});

test("응답 순서 처리: 앞선 번호의 응답(성공 · 실패)은 버리고, 쿼리가 바뀐 응답은 반영한 것으로 치지 않는다", () => {
  const order = replyOrder();
  const first = order.send();
  const second = order.send();
  assert.equal(order.busy(), true, "받는 중이면 폴링은 건너뛴다");
  assert.equal(order.settle(second), true);
  assert.equal(order.settle(first), false, "나중 것을 반영한 뒤 온 앞선 응답은 버린다");
  assert.equal(order.busy(), false);

  const stale = order.send();
  const fresh = order.send();
  assert.equal(order.settle(fresh, false), false, "보낸 뒤 쿼리가 바뀌었다");
  assert.equal(order.settle(stale), true, "반영하지 않은 응답은 반영한 것으로 치지 않아 앞선 번호도 반영된다");
});

test("그릴 구간: 보이는 행 둘레, 드래그 중인 행이 밖이면 거기까지 이어 그린다, 숨었으면 비운다", () => {
  assert.deepEqual(drawnRows({ first: 10, last: 17 }, 100, null, 0), { from: 3, to: 24 });
  assert.deepEqual(drawnRows({ first: 60, last: 67 }, 100, 40, 0), { from: 40, to: 74 }, "위로 멀어진 드래그 중인 행");
  assert.deepEqual(drawnRows({ first: 10, last: 17 }, 100, 50, 0), { from: 3, to: 51 }, "아래로 멀어진 드래그 중인 행");
  assert.deepEqual(drawnRows({ first: 10, last: 17 }, 100, 12, 0), { from: 3, to: 24 });
  assert.deepEqual(drawnRows(null, 100, null, 30), { from: 30, to: 30 }, "숨은 영역은 행 없이 스페이서만");
});

test("자리마다 받은 행, 받지 못한 자리는 null(번호 · 키는 목록 전체 기준)", () => {
  const slots = slotsOf({ from: 4, to: 8 }, 5, ["e", "f"], (row, i) => `${row}${i}`);
  assert.deepEqual(slots, [
    { key: "slot-4", row: null, index: 4 },
    { key: "e5", row: "e", index: 5 },
    { key: "f6", row: "f", index: 6 },
    { key: "slot-7", row: null, index: 7 },
  ]);
});

test("드래그의 높이 계산: 드래그 중인 행의 가운데가 이웃 행의 가운데를 넘어야 한 칸, 처음 · 끝에서 멈춘다", () => {
  assert.equal(heightTarget(10, 30, 64, 100), 10);
  assert.equal(heightTarget(10, 65, 64, 100), 11);
  assert.equal(heightTarget(10, 64 * 3 + 10, 64, 100), 13);
  assert.equal(heightTarget(10, -65, 64, 100), 9);
  assert.equal(heightTarget(10, -64 * 50, 64, 100), 0);
  assert.equal(heightTarget(98, 64 * 5, 64, 100), 99);
});

test("드래그 중인 행은 첫 행 ~ 마지막 행 위치에서 반 칸 더까지만 간다(그 밖으로 나가면 스크롤 영역이 늘어 자동 스크롤이 끝없이 따라간다)", () => {
  // 높이로 계산(대기열): 100곡 중 10번째, 행 64px
  assert.equal(boundedDy(64 * 200, 10, { h: 64, count: 100 }), 64 * 89.5);
  assert.equal(boundedDy(-64 * 200, 10, { h: 64, count: 100 }), -64 * 10.5);
  assert.equal(boundedDy(100, 10, { h: 64, count: 100 }), 100);
  assert.equal(boundedDy(50, 0, { h: 64, count: 1 }), 32, "한 곡뿐이면 반 칸까지");
  // 시작 때 잰 위치: 높이가 다른 세 항목(위 0 · 50 · 130, 높이 40 · 70 · 30)의 가운데 것
  const rows = { tops: [0, 50, 130], heights: [40, 70, 30] };
  assert.equal(boundedDy(500, 1, rows), 130 + 30 - (50 + 70) + 35, "아래 끝이 마지막 항목의 아래 끝을 반 칸 넘을 때까지");
  assert.equal(boundedDy(-500, 1, rows), -50 - 35, "위 끝이 첫 항목의 위 끝을 반 칸 넘을 때까지");
});

test("끝까지 끌면 마지막 자리 · 첫 자리가 된다(자른 거리로도 이웃 행의 가운데를 넘는다)", () => {
  const rows = { h: 64, count: 100 };
  assert.equal(heightTarget(10, boundedDy(64 * 500, 10, rows), 64, 100), 99);
  assert.equal(heightTarget(10, boundedDy(-64 * 500, 10, rows), 64, 100), 0);
  assert.equal(heightTarget(98, boundedDy(64 * 500, 98, rows), 64, 100), 99, "마지막 앞 행을 마지막으로");
  assert.equal(heightTarget(1, boundedDy(-64 * 500, 1, rows), 64, 100), 0, "둘째 행을 첫째로");
});
