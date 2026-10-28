// dashboard/src/composables/row-window.ts · utils/reply-order.ts — 긴 목록을 보이는 만큼만 받기.
// 지키는 것: 보이는 행 셈(숨어서 높이 0 이면 셈하지 않음 · 목록 끝), 받을 구간은 위아래 한 화면씩 덤(상한까지), 받은 구간이 덮는가(끝에서 짧은 구간).
// 받기 순서: 넣은 답보다 앞선 번호의 답은 성공 · 실패 모두 버리고, 보낸 뒤 질의가 바뀐 답은 넣지 않으며 넣은 것으로도 치지 않는다. 받는 중이면 busy

import { test } from "node:test";
import assert from "node:assert/strict";
import { aroundRows, covers, visibleRows } from "../../../dashboard/src/composables/row-window.ts";
import { replyOrder } from "../../../dashboard/src/utils/reply-order.ts";
import { LIST_WINDOW_MAX } from "../../../src/dashboard/contract/admin.ts";

test("보이는 행: 스크롤 위치 · 영역 높이로, 끝은 거른 수까지. 높이가 0 이면 셈하지 않는다", () => {
  assert.deepEqual(visibleRows(0, 312, 48, 100), { first: 0, last: 7 }, "6.5줄이 보이면 일곱째 행까지");
  assert.deepEqual(visibleRows(480, 312, 48, 100), { first: 10, last: 17 });
  assert.deepEqual(visibleRows(4600, 312, 48, 100), { first: 95, last: 100 });
  assert.deepEqual(visibleRows(0, 312, 48, 3), { first: 0, last: 3 });
  assert.equal(visibleRows(0, 0, 48, 100), null);
});

test("받을 구간: 위아래 한 화면씩 덤, 맨 위 · 맨 끝에서 잘린다, 상한까지", () => {
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

test("받기 순서: 앞선 번호의 답(성공 · 실패)은 버리고, 질의가 바뀐 답은 넣은 것으로 치지 않는다", () => {
  const order = replyOrder();
  const first = order.send();
  const second = order.send();
  assert.equal(order.busy(), true, "받는 중이면 폴링은 건너뛴다");
  assert.equal(order.settle(second), true);
  assert.equal(order.settle(first), false, "나중 것을 넣은 뒤 온 앞선 답은 버린다");
  assert.equal(order.busy(), false);

  const stale = order.send();
  const fresh = order.send();
  assert.equal(order.settle(fresh, false), false, "보낸 뒤 질의가 바뀌었다");
  assert.equal(order.settle(stale), true, "넣지 않은 답은 넣은 것으로 치지 않아 앞선 번호도 들어간다");
});
