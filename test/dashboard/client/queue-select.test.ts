// dashboard/src/composables/queue-select.ts: 대기열 고르기의 행 클릭. 고르기가 쓴 클릭(길게 누른 뒤, Ctrl 클릭, 고르는 중)은 true라 썸네일 크게 보기를 열지 않는다

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { useQueueSelect } from "../../../dashboard/src/composables/queue-select.ts";

// 행 안의 버튼을 가리는 검사가 Element를 본다. 테스트의 가짜 이벤트는 요소가 아니다
(globalThis as { Element?: unknown }).Element ??= class {};

type Row = { entry: number | null };
const rows: Row[] = [{ entry: 1 }, { entry: 2 }, { entry: 3 }];
const click = (keys: Partial<Pick<MouseEvent, "ctrlKey" | "shiftKey" | "metaKey">> = {}) => ({ ctrlKey: false, shiftKey: false, metaKey: false, target: null, currentTarget: null, ...keys }) as unknown as MouseEvent;
const press = (pointerType: string) => ({ pointerType, pointerId: 1, clientX: 0, clientY: 0, target: null, currentTarget: null }) as unknown as PointerEvent;

test("고르지 않을 때의 그냥 클릭은 고르기가 쓰지 않는다(false). Ctrl, Shift 클릭과 고르는 중의 클릭은 쓴다(true)", () => {
  const select = useQueueSelect({ rows: () => rows, selectable: () => true });
  assert.equal(select.rowClick(click(), rows[0]), false);
  assert.equal(select.count.value, 0);
  assert.equal(select.rowClick(click({ ctrlKey: true }), rows[0]), true);
  assert.equal(select.isPicked(rows[0]), true);
  assert.equal(select.rowClick(click(), rows[1]), true, "고르는 중에는 그냥 눌러도 더한다");
  assert.equal(select.count.value, 2);
});

test("손가락으로 길게 누르면 고르기를 시작하고, 손을 뗄 때 오는 click은 고르기가 받는다(true, 고른 곡을 바로 빼지 않는다)", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const select = useQueueSelect({ rows: () => rows, selectable: () => true });
    select.pressStart(press("touch"), rows[2]);
    mock.timers.tick(500);
    assert.equal(select.isPicked(rows[2]), true);
    assert.equal(select.rowClick(click(), rows[2]), true);
    assert.equal(select.isPicked(rows[2]), true, "그 click이 다시 빼지 않는다");
  } finally {
    mock.timers.reset();
  }
});
