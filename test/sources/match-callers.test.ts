// 같은 곡 매칭을 부르는 두 곳의 검색 방식. 동등물(스포티파이 곡 → 유튜브)과 자동재생(후보 → 유튜브)이
// 같은 곡을 찾을 때 어떤 검색어를 몇 개씩 묻는지 적어 둔다.
//
// 둘은 match.searchCandidates 의 이름 붙은 방식(exact · cheap)을 쓴다. 다른 까닭은 그 방식 표에 적었다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildSearchQueries, searchCandidates } from "../../src/sources/youtube/match.ts";
import * as equivalent from "../../src/sources/youtube/equivalent.ts";
import * as route from "../../src/autoplay/route.ts";
import * as filterModule from "../../src/autoplay/filter.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { inGuild } from "../../src/infra/guild-context.ts";

const store = openTempStore("match-callers-");
after(() => store.close());

// TV 버전은 1차 검색어가 넷이라 "전부"와 "앞 둘"이 나뉜다
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

test("동등물: 1차 전부와 2차 전부를 6개씩, 아티스트 이름만 15개를 묻는다. 1차에 답이 있어도 2차를 묻는다", async () => {
  for (const primaryHits of [false, true]) {
    const { asked, search } = searcher(primaryHits);
    await equivalent.findYouTubeEquivalent({ title: TARGET.title, artist: TARGET.artist, duration: TARGET.durationSec }, { search });
    assert.deepEqual(asked, [...[...primary, ...secondary].map((q) => [q, 6]), [TARGET.artist, 15]], `1차 답 ${primaryHits}`);
  }
});

test("자동재생: 1차 앞 둘을 6개씩 묻고, 1차에 답이 없을 때만 2차 앞 둘을 묻는다", async () => {
  for (const primaryHits of [false, true]) {
    const { asked, search } = searcher(primaryHits);
    const deps: route.Deps = { ...route.REAL, search, known: () => null, pinned: () => null, assist: { filter: async (c) => c, accepts: async () => true } };
    await route.resolve({ artist: TARGET.artist, title: TARGET.title, durationSec: TARGET.durationSec, sourceKey: "lf:1" }, LIMITS, undefined, deps);
    const expected = primaryHits ? primary.slice(0, 2) : [...primary.slice(0, 2), ...secondary.slice(0, 2)];
    assert.deepEqual(
      asked,
      expected.map((q) => [q, 6]),
      `1차 답 ${primaryHits}`,
    );
  }
});

test("동등물: 같은 곡을 같은 줄에서 찾는 중이면 검색 한 벌의 답을 같이 받는다. 끝나면 다시 찾는다", async () => {
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  const { asked, search } = searcher(true);
  const slow = async (query: string, limit: number) => (await gate, search(query, limit));
  const song = (): equivalent.Seeking => ({ title: TARGET.title, artist: TARGET.artist, duration: TARGET.durationSec, requestKey: "sp:joined" });
  const a = song();
  const b = song();
  const both = Promise.all([equivalent.findYouTubeEquivalent(a, { search: slow }), equivalent.findYouTubeEquivalent(b, { search: slow })]);
  release();
  assert.deepEqual(await both, [HIT[0].audioUrl, HIT[0].audioUrl]);
  assert.equal(b.audioFoundBy, "search");
  assert.equal(asked.length, primary.length + secondary.length + 1, "검색 한 벌(아티스트 검색 포함)");
  await equivalent.findYouTubeEquivalent(song(), { search });
  assert.equal(asked.length, 2 * (primary.length + secondary.length + 1), "끝난 뒤에는 새로 찾는다");
});

test("동등물: 미리 받기(뒤 줄)가 찾는 곡에 지금 곡(앞 줄)이 붙지 않는다. 찾지 못한 답도 같이 받는다", async () => {
  let release = () => {};
  const gate = new Promise<void>((done) => (release = done));
  let calls = 0;
  const failing = async () => {
    calls++;
    await gate;
    throw new Error("검색 실패");
  };
  const song = () => ({ title: TARGET.title, artist: TARGET.artist, duration: TARGET.durationSec, requestKey: "sp:lanes" });
  const background = inGuild("g", () => Promise.all([equivalent.findYouTubeEquivalent(song(), { search: failing }), equivalent.findYouTubeEquivalent(song(), { search: failing })]), "prefetch");
  const now = equivalent.findYouTubeEquivalent(song(), { search: failing });
  release();
  assert.deepEqual(await Promise.all([background, now]), [[null, null], null]);
  assert.equal(calls, 2 * (primary.length + secondary.length + 1), "뒤 줄 둘은 한 벌, 앞 줄은 따로 한 벌");
});

// 검색어마다 다른 영상 하나를 주고, 늦게 물은 것이 먼저 끝나게 한다. 동시에 떠 있던 수의 최대를 잰다
function racing(failing: string | null = null) {
  const asked: string[] = [];
  let open = 0;
  let peak = 0;
  const search = async (query: string) => {
    asked.push(query);
    open++;
    peak = Math.max(peak, open);
    await new Promise((done) => setTimeout(done, 40 - asked.length * 3));
    open--;
    if (query === failing) throw new Error("검색 실패");
    const id = `q${[...primary, ...secondary].indexOf(query)}`;
    return [{ id, audioUrl: `https://www.youtube.com/watch?v=${id}`, title: "A - Song", artist: "A", duration: 240 }];
  };
  return { asked, search, peak: () => peak };
}

test("검색: exact 는 1차 · 2차 검색어를 한꺼번에 묻고, 합친 차례는 검색어 차례다. 한 검색어가 실패해도 나머지로", async () => {
  const { search, peak } = racing(primary[1]);
  const found = (await searchCandidates(TARGET, search, "exact")).candidates;
  assert.equal(peak(), primary.length + secondary.length + 1, "아티스트 검색도 함께");
  const all = [...primary, ...secondary];
  assert.deepEqual(
    found.map((c) => c.id),
    all.map((q, i) => (q === primary[1] ? null : `q${i}`)).filter(Boolean),
  );
});

test("검색: cheap 는 1차 앞 둘을 한꺼번에 묻고, 2차는 1차가 빈 것을 본 뒤에 묻는다", async () => {
  const asked: string[] = [];
  const empty = async (query: string) => (asked.push(query), await new Promise((done) => setTimeout(done, 10)), []);
  const pending = searchCandidates(TARGET, empty, "cheap");
  assert.deepEqual(asked, primary.slice(0, 2), "1차 둘이 함께 떠 있다");
  await pending;
  assert.deepEqual(asked, [...primary.slice(0, 2), ...secondary.slice(0, 2)]);
});

test("검색: exact 는 아티스트 채널을 알아보고 그 채널의 이 곡일 수 있는 영상을 2차 자리에 더한다. cheap 는 아티스트 검색을 하지 않는다", async () => {
  const asked: Array<[string, number]> = [];
  const own = (id: string, title: string, duration: number) => ({ id, audioUrl: `https://www.youtube.com/watch?v=${id}`, title, artist: "공식", duration });
  const search = async (query: string, limit: number) => {
    asked.push([query, limit]);
    if (query === TARGET.artist) return [own("o1", "A - Song (TV Size)", 240), own("o2", "다른 노래", 240), own("o3", "A - Song (TV Size) MV", 250), own("o4", "또 다른 노래", 200), { id: "x1", audioUrl: "u", title: "Song", artist: "남", duration: 240 }];
    return [];
  };
  const found = await searchCandidates(TARGET, search, "exact");
  assert.deepEqual(found.artistChannels, ["공식"]);
  assert.deepEqual(
    found.candidates.map((c) => c.id),
    ["o1", "o3"],
  );
  assert.ok(
    found.candidates.every((c) => (c.rank ?? 0) >= 8),
    "2차 자리(순위를 뒤로)",
  );
  asked.length = 0;
  const cheap = await searchCandidates(TARGET, search, "cheap");
  assert.deepEqual(cheap.artistChannels, []);
  assert.ok(!asked.some(([q]) => q === TARGET.artist));
});
