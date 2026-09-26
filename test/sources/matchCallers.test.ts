// 같은 곡 매칭을 부르는 두 곳의 검색 방식. 동등물(스포티파이 곡 → 유튜브)과 자동재생(후보 → 유튜브)이
// 같은 곡을 찾을 때 어떤 검색어를 몇 개씩 묻는지 적어 둔다.
//
// 둘은 match.searchCandidates 의 이름 붙은 방식(exact · cheap)을 쓴다. 다른 까닭은 그 방식 표에 적었다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildSearchQueries } from "../../src/sources/youtube/match.ts";
import * as equivalent from "../../src/sources/youtube/equivalent.ts";
import * as route from "../../src/autoplay/route.ts";
import * as filterModule from "../../src/autoplay/filter.ts";
import { openTempStore } from "../helpers/tempStore.ts";

const store = openTempStore("match-callers-");
after(() => store.close());

// TV 판은 1차 검색어가 넷이라 "전부"와 "앞 둘"이 갈린다
const TARGET = { artist: "A feat. B", title: "Song (TV Size)", durationSec: 240 };
const { primary, secondary } = buildSearchQueries(TARGET);
const HIT = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "A - Song (TV Size)", artist: "A", duration: 240 }];
const LIMITS = filterModule.prepare({ minDurationSec: 60, maxDurationSec: 3600, blockedKeywords: [] });

// 1차 검색어에 답이 있나에 따라 검색 결과를 준다. 물은 것을 [검색어, 개수] 로 적는다
function searcher(primaryHits: boolean) {
  const asked: Array<[string, number]> = [];
  const search = async (query: string, limit: number) => {
    asked.push([query, limit]);
    return primaryHits && primary.includes(query) ? HIT : [];
  };
  return { asked, search };
}

test("검색어는 1차 여럿 · 2차 여럿이다(이 표의 전제)", () => {
  assert.ok(primary.length > 2, `1차 ${primary.length}개`);
  assert.ok(secondary.length > 0, `2차 ${secondary.length}개`);
});

test("동등물: 1차 전부와 2차 전부를 6개씩 묻는다. 1차에 답이 있어도 2차를 묻는다", async () => {
  for (const primaryHits of [false, true]) {
    const { asked, search } = searcher(primaryHits);
    await equivalent.findYouTubeEquivalent({ title: TARGET.title, artist: TARGET.artist, duration: TARGET.durationSec }, { search });
    assert.deepEqual(
      asked,
      [...primary, ...secondary].map((q) => [q, 6]),
      `1차 답 ${primaryHits}`,
    );
  }
});

test("자동재생: 1차 앞 둘을 6개씩 묻고, 1차에 답이 없을 때만 2차 앞 둘을 묻는다", async () => {
  for (const primaryHits of [false, true]) {
    const { asked, search } = searcher(primaryHits);
    const deps: route.Deps = { ...route.REAL, search, known: () => null, assist: { filter: async (c) => c, accepts: async () => true } };
    await route.resolve({ artist: TARGET.artist, title: TARGET.title, durationSec: TARGET.durationSec, sourceKey: "lf:1" }, LIMITS, undefined, deps);
    const expected = primaryHits ? primary.slice(0, 2) : [...primary.slice(0, 2), ...secondary.slice(0, 2)];
    assert.deepEqual(
      asked,
      expected.map((q) => [q, 6]),
      `1차 답 ${primaryHits}`,
    );
  }
});
