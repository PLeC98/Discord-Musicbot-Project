// src/rules/search-pick.ts, src/rules/autocomplete-budget.ts: 검색에서 선택한 곡의 값(유튜브, 스포티파이)과 자동완성이 검색을 기다릴 시간

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUrl, pickValue, readPick } from "../../src/rules/search-pick.ts";
import { autocompleteBudget } from "../../src/rules/autocomplete-budget.ts";

test("선택한 곡의 값은 yt:<영상 id>. 모양이 맞을 때만 곡으로 읽는다(직접 입력한 글자는 검색어)", () => {
  assert.equal(pickValue({ platform: "youtube", id: "abcdefghijk" }), "yt:abcdefghijk");
  assert.deepEqual(readPick(" yt:abcdefghijk "), { platform: "youtube", id: "abcdefghijk" });
  for (const typed of ["yt:짧음", "yt:abcdefghijkl", "YT:abcdefghijk", "abcdefghijk", "yt: abcdefghijk"]) assert.equal(readPick(typed), null, typed);
  assert.equal(pickUrl({ platform: "youtube", id: "abcdefghijk" }), "https://www.youtube.com/watch?v=abcdefghijk");
});

test("스포티파이 곡은 sp:<22자 곡 id>, 주소는 곡 링크", () => {
  const id = "1SwZVVH9BnXtLRLi2cbFhw";
  assert.equal(pickValue({ platform: "spotify", id }), `sp:${id}`);
  assert.deepEqual(readPick(`sp:${id}`), { platform: "spotify", id });
  for (const typed of ["sp:짧음", `sp:${id}x`, `sp:${id.slice(1)}-`]) assert.equal(readPick(typed), null, typed);
  assert.equal(pickUrl({ platform: "spotify", id }), `https://open.spotify.com/track/${id}`);
});

test("자동완성 기다릴 시간: 3초에서 지난 시간과 여유를 빼고, 시계가 어긋나도 300 ~ 2400ms 에 가둔다", () => {
  assert.equal(autocompleteBudget(1000, 1150), 2250);
  assert.equal(autocompleteBudget(1000, 1000), 2400, "봇 시계가 늦어 지난 시간이 0 이하면 상한");
  assert.equal(autocompleteBudget(1000, -5000), 2400);
  assert.equal(autocompleteBudget(1000, 3500), 300, "이미 마감 가까이면 하한");
  assert.equal(autocompleteBudget(1000, 60_000), 300);
});
