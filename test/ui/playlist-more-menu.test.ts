// src/ui/playlist-more-menu.ts — 더 넣기 화면. 가져오는 동안 몇 곡째인지, 곡 수 모달에 미리 적어 둘 수

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchingView } from "../../src/ui/playlist-more-menu.ts";
import * as More from "../../src/usecases/playlist-more.ts";
import type { MoreState } from "../../src/rules/more-choices.ts";
import { post } from "../../src/ui/frame.ts";
import { textsOf } from "../helpers/cv2.ts";

test("가져오는 동안: 처음엔 가져오는 중, 진행이 오면 몇 곡째", () => {
  assert.deepEqual(textsOf(post(fetchingView())), ["⏳ 곡을 가져오는 중…"]);
  assert.deepEqual(textsOf(post(fetchingView({ done: 3, want: 10 }))), ["⏳ 3/10곡 가져오는 중…"]);
});

test("곡 수 모달: 남은 슬롯 · 출처의 한 번 상한 안에서, 미리 적어 둘 수는 배치와 그 상한 중 작은 쪽", () => {
  const state: MoreState = { kind: "ytp", listId: "PLabcdefghij", offset: 50, anchorId: "aaaaaaaaaaa", insertFirst: false, requesterId: null };
  const input = (cap: number, batch: number) => {
    const json = More.countModal(state, cap, batch).toJSON() as { components: Array<{ components: Array<{ label: string; placeholder?: string }> }> };
    return json.components[0].components[0];
  };
  assert.deepEqual([input(200, 50).label, input(200, 50).placeholder], ["넣을 곡 수 (1~200)", "50"]);
  assert.deepEqual([input(30, 50).label, input(30, 50).placeholder], ["넣을 곡 수 (1~30)", "30"]);
});
