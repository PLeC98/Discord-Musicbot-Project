// src/rules/search-mix.ts: 검색 결과 섞기. 스포티파이 몫, 한쪽이 모자랄 때 채우기, 같은 것 빼기

import { test } from "node:test";
import assert from "node:assert/strict";
import { mixCounts, uniqueBy } from "../../src/rules/search-mix.ts";

test("둘 다 넉넉하면 스포티파이 몫만, 한쪽이 모자라면 다른 쪽으로 채운다", () => {
  const of = (youtube: number, spotify: number, spotifyShare = 3) => mixCounts(youtube, spotify, { total: 10, spotifyShare });
  assert.deepEqual(of(20, 20), { youtube: 7, spotify: 3 });
  assert.deepEqual(of(2, 20), { youtube: 2, spotify: 8 });
  assert.deepEqual(of(20, 1), { youtube: 9, spotify: 1 });
  assert.deepEqual(of(0, 20), { youtube: 0, spotify: 10 });
  assert.deepEqual(of(3, 2), { youtube: 3, spotify: 2 });
  assert.deepEqual(of(20, 20, 0), { youtube: 10, spotify: 0 }, "몫이 0 이면 유튜브가 모자랄 때만");
  assert.deepEqual(of(4, 20, 0), { youtube: 4, spotify: 6 });
});

test("키가 같은 것은 처음 하나만", () => {
  assert.deepEqual(
    uniqueBy(["a1", "b1", "a2", "c1"], (s) => s[0]),
    ["a1", "b1", "c1"],
  );
});
