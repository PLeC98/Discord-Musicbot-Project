// dashboard/src/cache-db/split.ts: 캐시 DB 화면의 격자와 편집 창 사이 경계. 편집 창은 최소 폭을 지키고 격자에 최소 폭을 남기며, 좁은 화면의 격자 높이는 창 높이의 80%까지

import { test } from "node:test";
import assert from "node:assert/strict";
import { GRID_HEIGHT, GRID_MIN_WIDTH, HANDLE, PANE_WIDTH, gridHeight, paneWidth } from "../../../dashboard/src/cache-db/split.ts";

test("편집 창 폭: 최소 폭 아래로 줄지 않고, 격자 최소 폭과 손잡이를 남긴 만큼까지 넓어진다", () => {
  assert.equal(paneWidth(100, 1400), PANE_WIDTH.min);
  assert.equal(paneWidth(500, 1400), 500);
  assert.equal(paneWidth(5000, 1400), 1400 - GRID_MIN_WIDTH - HANDLE);
});

test("편집 창 폭: 줄이 좁아 둘 다 지킬 수 없으면 편집 창 최소 폭이 먼저다. 줄 폭을 아직 모르면(0) 최소 폭만 지킨다", () => {
  assert.equal(paneWidth(400, 500), PANE_WIDTH.min);
  assert.equal(paneWidth(PANE_WIDTH.initial, 0), PANE_WIDTH.initial);
  assert.equal(paneWidth(100, 0), PANE_WIDTH.min);
});

test("격자 높이: 최소 높이와 창 높이의 80% 사이", () => {
  assert.equal(gridHeight(50, 900), GRID_HEIGHT.min);
  assert.equal(gridHeight(400, 900), 400);
  assert.equal(gridHeight(2000, 900), 720);
  assert.equal(gridHeight(400, 100), GRID_HEIGHT.min, "창이 아주 낮아도 최소 높이는 지킨다");
});
