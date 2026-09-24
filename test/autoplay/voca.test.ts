// src/autoplay/sources/voca.ts — VocaDB 계열(VocaDB · UtaiteDB · TouhouDB) 소스.
//
// 지키려는 계약:
//  · 내려간 영상(disabled)은 고르지 않는다. 원곡(Original) 영상을 먼저, 없으면 다른 유튜브 영상
//  · 만든 사람과 부른 쪽만 이름으로 쓴다("제작 feat. 가수"). 애니메이터 · 일러스트레이터까지 붙은 artistString 은 마지막 수단
//  · 가사 언어는 언어마다 따로 묻고 합친다. 같은 곡은 한 번. 한 언어가 실패해도 나머지는 살린다. 다 실패하면 던진다
//  · 설정 칸이 저쪽 파라미터로 바뀐다(BPM 은 천 배, 연도는 날짜, 가수를 걸면 하위 보이스뱅크까지)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { vocaFamily } from "../../src/autoplay/sources/voca.ts";
import { useFetch } from "../../src/autoplay/sources/http.ts";
import type { GenreSource } from "../../src/config/genres.ts";
import { fake } from "../helpers/fake.ts";

after(() => useFetch(null));

type Song = { id: number; name?: string; artistString?: string; lengthSeconds?: number; pvs?: Array<Record<string, unknown>>; artists?: Array<{ name: string; categories: string }> };

// 곡 목록을 주는 가짜. 전체 개수를 묻는 요청(maxResults=1)과 목록 요청을 가르고, 언어별로 다른 곡을 줄 수 있다
function serve(songsFor: (lang: string | null) => Song[] | Error) {
  const urls: URL[] = [];
  useFetch(
    fake<typeof fetch>(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      const got = songsFor(url.searchParams.get("advancedFilters[0][param]"));
      if (got instanceof Error) return { ok: false, status: 500, json: async () => ({}) };
      if (url.searchParams.get("maxResults") === "1") return { ok: true, status: 200, json: async () => ({ totalCount: got.length }) };
      return { ok: true, status: 200, json: async () => ({ items: got }) };
    }),
  );
  return urls;
}

const source = (extra: Partial<GenreSource> = {}): GenreSource => ({ type: "vocadb", ...extra }) as GenreSource;
const yt = (url: string, extra: Record<string, unknown> = {}) => ({ service: "Youtube", pvType: "Original", url, ...extra });
const song = (id: number, pvs: Array<Record<string, unknown>>, extra: Partial<Song> = {}): Song => ({ id, name: `곡${id}`, artistString: "누군가", pvs, ...extra });

test("내려간 영상은 고르지 않는다. 원곡 영상을 먼저, 없으면 다른 유튜브 영상", async () => {
  serve(() => [song(1, [yt("https://y/dead", { disabled: true }), yt("https://y/reprint", { pvType: "Reprint" }), yt("https://y/alive")]), song(2, [yt("https://y/dead2", { disabled: true }), yt("https://y/reprint2", { pvType: "Reprint" })]), song(3, [{ service: "NicoNicoDouga", pvType: "Original", url: "https://nico/3" }]), song(4, [yt("https://y/dead4", { disabled: true })])]);
  const got = await vocaFamily(source());
  assert.deepEqual(
    got.map((c) => [c.title, c.youtubeUrl]),
    [
      ["곡1", "https://y/alive"],
      ["곡2", "https://y/reprint2"],
    ],
    "3은 유튜브 영상이 없고 4는 살아 있는 영상이 없다",
  );
});

test("이름은 제작 feat. 가수. 역할이 없으면 artistString", async () => {
  serve(() => [
    song(1, [yt("https://y/1")], {
      artists: [
        { name: "제작자", categories: "Producer" },
        { name: "가수", categories: "Vocalist" },
        { name: "그림", categories: "Illustrator" },
      ],
    }),
    song(2, [yt("https://y/2")], { artistString: "제작자 feat. 가수 (그림: 누구)" }),
  ]);
  const got = await vocaFamily(source({ type: "utaitedb" }));
  assert.deepEqual(
    got.map((c) => c.artist),
    ["제작자 feat. 가수", "제작자 feat. 가수 (그림: 누구)"],
  );
  assert.deepEqual(
    got.map((c) => [c.platform, c.sourceKey, c.sourceUrl]),
    [
      ["utaitedb", "utaitedb:1", "https://utaitedb.net/S/1"],
      ["utaitedb", "utaitedb:2", "https://utaitedb.net/S/2"],
    ],
  );
});

test("가사 언어는 언어마다 따로 묻고 합친다. 같은 곡은 한 번", async () => {
  const urls = serve((lang) => (lang === "ja" ? [song(1, [yt("https://y/1")]), song(2, [yt("https://y/2")])] : [song(2, [yt("https://y/2")]), song(3, [yt("https://y/3")])]));
  const got = await vocaFamily(source({ languages: ["ja", "en"] }));
  assert.deepEqual(got.map((c) => c.title).sort(), ["곡1", "곡2", "곡3"]);
  const langs = new Set(urls.map((u) => u.searchParams.get("advancedFilters[0][param]")));
  assert.deepEqual([...langs].sort(), ["en", "ja"], "둘을 한 요청에 걸면 둘 다 있는 곡만 온다");
});

test("한 언어가 실패해도 나머지는 살린다. 다 실패하면 던진다", async () => {
  serve((lang) => (lang === "ja" ? new Error("down") : [song(1, [yt("https://y/1")])]));
  assert.deepEqual(
    (await vocaFamily(source({ languages: ["ja", "en"] }))).map((c) => c.title),
    ["곡1"],
  );

  serve(() => new Error("down"));
  await assert.rejects(vocaFamily(source({ languages: ["ja", "en"] })), /HTTP 500/);
});

test("곡이 없으면 목록을 묻지 않는다", async () => {
  const urls = serve(() => []);
  assert.deepEqual(await vocaFamily(source()), []);
  assert.equal(urls.length, 1, "개수만 묻고 끝");
});

test("설정 칸이 저쪽 파라미터로 바뀐다", async () => {
  const urls = serve(() => []);
  await vocaFamily(source({ tags: ["rock"], minBpm: 120, maxBpm: 180, yearFrom: 2010, yearTo: 2015, artistIds: [7], sort: "PublishDate" }));
  const q = urls[0].searchParams;
  assert.equal(urls[0].host, "vocadb.net");
  assert.equal(q.get("minMilliBpm"), "120000");
  assert.equal(q.get("maxMilliBpm"), "180000");
  assert.equal(q.get("afterDate"), "2010-01-01");
  assert.equal(q.get("beforeDate"), "2015-12-31");
  assert.equal(q.get("childVoicebanks"), "true", "가수를 걸면 하위 보이스뱅크까지");
  assert.equal(q.get("pvServices"), "Youtube", "틀 수 있는 것만");
  assert.equal(q.get("sort"), "PublishDate");
  assert.deepEqual(q.getAll("tagName[]"), ["rock"]);
});

test("VocaDB 계열이 아닌 종류로 부르면 던진다", async () => {
  await assert.rejects(vocaFamily(source({ type: "lastfm" })), /VocaDB 계열이 아닙니다/);
});
