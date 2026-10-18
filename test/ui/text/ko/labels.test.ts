// src/ui/text/ko/labels.ts — 라벨을 모두 적어 둔다. 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as labels from "../../../../src/ui/text/ko/labels.ts";

test("여러 곡을 담은 출처의 이름. 모르면 재생목록", () => {
  assert.deepEqual(["playlist", "album", "artist", "mix", null, undefined].map(labels.collection), ["재생목록", "앨범", "아티스트 인기곡", "재생목록", "재생목록", "재생목록"]);
});

test("곡 수", () => {
  assert.equal(labels.trackCount(12), "12곡");
});

test("곡 제목. 출처가 제목을 주지 않았으면 알 수 없는 곡", () => {
  assert.deepEqual(["곡", null, undefined, ""].map(labels.songTitle), ["곡", "알 수 없는 곡", "알 수 없는 곡", "알 수 없는 곡"]);
});
