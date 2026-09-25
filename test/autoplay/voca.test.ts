// src/autoplay/sources/voca.ts — VocaDB 계열(VocaDB · UtaiteDB · TouhouDB) 소스.
//
// 지키려는 계약:
//  · 내려간 영상(disabled)은 고르지 않는다. 원곡(Original) 영상을 먼저, 없으면 다른 유튜브 영상
//  · 만든 사람과 부른 쪽만 이름으로 쓴다("제작 feat. 가수"). 애니메이터 · 일러스트레이터까지 붙은 artistString 은 마지막 수단
//  · 가사 언어는 언어마다 따로 묻고 합친다. 같은 곡은 한 번. 한 언어가 실패해도 나머지는 살린다. 다 실패하면 던진다
//  · 설정 칸이 저쪽 파라미터로 바뀐다(BPM 은 천 배, 연도는 날짜, 가수를 걸면 하위 보이스뱅크까지)
//  · 이름으로 적는 칸(태그 · 제외 태그 · 가수)은 id 로 풀어 건다. 못 풀면 던진다(없는 태그를 이름으로 걸면 저쪽이 0곡을 조용히 준다)

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { vocaFamily, suggest, _forgetIds } from "../../src/autoplay/sources/voca.ts";
import { useFetch } from "../../src/autoplay/sources/http.ts";
import type { GenreSource } from "../../src/config/genres.ts";
import { VOCA_WINDOW } from "../../src/config/schema/genreSources.ts";
import { fake } from "../helpers/fake.ts";

after(() => useFetch(null));
beforeEach(() => _forgetIds());

type Song = { id: number; name?: string; artistString?: string; lengthSeconds?: number; pvs?: Array<Record<string, unknown>>; artists?: Array<{ name: string; categories: string }> };
type Artist = { id: number; name: string; names?: Array<{ value: string }> };
/** 이름 풀기에 저쪽이 줄 것. 태그는 이름(별칭 포함) → id, 가수는 검색 결과 그대로 */
type Lookup = { tags?: Record<string, number>; artists?: Artist[] };

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

// 곡 목록을 주는 가짜. 전체 개수를 묻는 요청(maxResults=1)과 목록 요청을 가르고, 언어별로 다른 곡을 줄 수 있다
function serve(songsFor: (lang: string | null) => Song[] | Error, lookup: Lookup = {}) {
  const urls: URL[] = [];
  useFetch(
    fake<typeof fetch>(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.startsWith("/api/tags/byName/")) {
        const id = lookup.tags?.[decodeURIComponent(url.pathname.slice("/api/tags/byName/".length))];
        return json(id ? { id } : null);
      }
      if (url.pathname === "/api/artists") return json({ items: lookup.artists || [] });
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

const songsAsked = (urls: URL[]) => urls.filter((u) => u.pathname === "/api/songs");

test("설정 칸이 저쪽 파라미터로 바뀐다", async () => {
  const urls = serve(() => [], { tags: { rock: 481 }, artists: [{ id: 1, name: "初音ミク" }] });
  await vocaFamily(source({ tags: ["rock"], minBpm: 120, maxBpm: 180, yearFrom: 2010, yearTo: 2015, artists: ["初音ミク"], sort: "PublishDate" }));
  const [asked] = songsAsked(urls);
  const q = asked.searchParams;
  assert.equal(asked.host, "vocadb.net");
  assert.equal(q.get("minMilliBpm"), "120000");
  assert.equal(q.get("maxMilliBpm"), "180000");
  assert.equal(q.get("afterDate"), "2010-01-01");
  assert.equal(q.get("beforeDate"), "2015-12-31");
  assert.equal(q.get("childVoicebanks"), "true", "가수를 걸면 하위 보이스뱅크까지");
  assert.equal(q.get("pvServices"), "Youtube", "틀 수 있는 것만");
  assert.equal(q.get("sort"), "PublishDate");
  assert.deepEqual(q.getAll("tagId[]"), ["481"]);
  assert.deepEqual(q.getAll("tagName[]"), [], "이름으로 걸면 없는 태그가 0곡으로 조용히 끝난다");
  assert.deepEqual(q.getAll("artistId[]"), ["1"]);
});

test("태그 · 제외 태그 · 가수는 id 로 풀어 건다. 가수는 칸이 뜻하는 분류에서만 찾는다", async () => {
  const urls = serve(() => [], { tags: { rock: 481, ロック: 481, 和風: 90, cover: 12 }, artists: [{ id: 28174, name: "UNI" }] });
  await vocaFamily(source({ tags: ["ロック", "和風"], excludeTags: ["cover"], artists: ["UNI"] }));
  const q = songsAsked(urls)[0].searchParams;
  assert.deepEqual(q.getAll("tagId[]"), ["481", "90"], "별칭도 저쪽이 푼다");
  assert.deepEqual(q.getAll("excludedTagIds[]"), ["12"]);
  assert.deepEqual(q.getAll("artistId[]"), ["28174"]);

  const [vocal] = urls.filter((u) => u.pathname === "/api/artists");
  assert.equal(vocal.searchParams.get("query"), "UNI");
  assert.ok(vocal.searchParams.get("artistTypes")?.split(",").includes("Vocaloid"), "vocadb 의 「특정 보컬만」은 보컬 라이브러리에서 찾는다");

  _forgetIds();
  const touhou = serve(() => [], { artists: [{ id: 1, name: "ZUN" }] });
  await vocaFamily(source({ type: "touhoudb", artists: ["ZUN"] }));
  assert.equal(touhou.find((u) => u.pathname === "/api/artists")?.searchParams.get("artistTypes"), null, "touhoudb 는 서클 · 작곡가라 거르지 않는다");
});

test("같은 이름이 여럿 오면 대표 이름, 별칭, 대소문자만 다른 것 순으로 고른다", async () => {
  // 저쪽은 곡 많은 순으로 준다. Exact 로 물어도 별칭 · 대소문자 다른 것이 섞여 온다
  const found = [
    { id: 136671, name: "ユニちゃん", names: [{ value: "UNI" }] },
    { id: 193691, name: "Urchin", names: [{ value: "Uni" }] },
    { id: 28174, name: "UNI" },
  ];
  const picked = async (name: string) => {
    _forgetIds();
    const urls = serve(() => [], { artists: found });
    await vocaFamily(source({ artists: [name] }));
    return songsAsked(urls)[0].searchParams.get("artistId[]");
  };
  assert.equal(await picked("UNI"), "28174", "대표 이름이 똑같은 것");
  assert.equal(await picked("Uni"), "193691", "별칭이 똑같은 것");
  assert.equal(await picked("uni"), "136671", "대소문자만 다르면 곡 많은 쪽");
});

test("사이트에 없는 이름이면 곡을 묻지 않고 던진다. 부르는 쪽이 다음 소스로 넘어간다", async () => {
  const urls = serve(() => [song(1, [yt("https://y/1")])], { tags: { rock: 481 }, artists: [{ id: 5, name: "初音ミクP" }] });
  await assert.rejects(vocaFamily(source({ tags: ["rock", "없는태그"] })), /vocadb에 없는 태그입니다: 없는태그/);
  await assert.rejects(vocaFamily(source({ excludeTags: ["없는태그"] })), /없는 태그입니다/);
  await assert.rejects(vocaFamily(source({ artists: ["初音ミク"] })), /vocadb에서 찾지 못한 이름입니다: 初音ミク/, "이름이 비슷하기만 한 것은 고르지 않는다");
  assert.deepEqual(songsAsked(urls), []);
});

test("푼 id 는 기억하고, 못 푼 것은 기억하지 않는다", async () => {
  const lookup: Lookup = { tags: { rock: 481 } };
  const urls = serve(() => [], lookup);
  const one = source({ tags: ["rock", "jazz"] });
  await assert.rejects(vocaFamily(one), /jazz/);

  lookup.tags = { rock: 481, jazz: 7 }; // 나중에 생겼다
  await vocaFamily(one);
  await vocaFamily(one);
  const asked = urls.filter((u) => u.pathname.startsWith("/api/tags/")).map((u) => decodeURIComponent(u.pathname.split("/").pop() || ""));
  assert.deepEqual(asked, ["rock", "jazz", "jazz"], "rock 은 한 번만, jazz 는 없던 때를 기억하지 않아 다시 묻는다");
});

test("정렬 순서의 앞쪽에서만 고른다. 가수 · 가수 분류를 걸면 더 앞쪽. 저쪽이 깊은 창을 못 준다", async (t) => {
  t.mock.method(Math, "random", () => 0.999); // 가장 깊은 창
  const starts = async (extra: Partial<GenreSource>, total = 300_000) => {
    _forgetIds();
    const urls: URL[] = [];
    useFetch(
      fake<typeof fetch>(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname === "/api/artists") return json({ items: [{ id: 1, name: "初音ミク" }] });
        return json(url.searchParams.get("maxResults") === "1" ? { totalCount: total } : { items: [] });
      }),
    );
    await vocaFamily(source(extra));
    return Number(urls.find((u) => u.pathname === "/api/songs" && u.searchParams.get("maxResults") !== "1")?.searchParams.get("start"));
  };
  const { depth, narrowDepth } = VOCA_WINDOW;
  const plain = await starts({});
  assert.ok(plain > narrowDepth && plain < depth, `조건이 없으면 앞 ${depth}곡에서: ${plain}`);
  assert.ok((await starts({ minScore: 50 }, 7082)) > 7000, "그보다 적으면 전체에서");
  assert.ok((await starts({ artists: ["初音ミク"] })) < narrowDepth);
  assert.ok((await starts({ artistTypes: ["UTAU"] })) < narrowDepth);
  assert.ok((await starts({ artists: ["  "] })) > narrowDepth, "빈 칸은 조건이 아니다(화면도 같은 셈)");
});

test("가수 분류는 advancedFilters 로, 가사 언어 뒤에 번호를 이어 건다", async () => {
  const urls = serve(() => []);
  await vocaFamily(source({ languages: ["ja"], artistTypes: ["Vocaloid", "UTAU"] }));
  const q = songsAsked(urls)[0].searchParams;
  assert.deepEqual(
    [0, 1, 2].map((i) => [q.get(`advancedFilters[${i}][filterType]`), q.get(`advancedFilters[${i}][param]`)]),
    [
      ["Lyrics", "ja"],
      ["ArtistType", "Vocaloid"],
      ["ArtistType", "UTAU"],
    ],
    "번호가 겹치면 앞의 조건을 덮는다",
  );

  await assert.rejects(vocaFamily(source({ type: "touhoudb", artistTypes: ["Vocaloid"] })), /touhoudb에는 가수 분류가 없습니다/);
});

test("VocaDB 계열이 아닌 종류로 부르면 던진다", async () => {
  await assert.rejects(vocaFamily(source({ type: "lastfm" })), /VocaDB 계열이 아닙니다/);
});

test("자동완성: 태그는 이름 목록, 가수는 이름 풀기와 같은 분류로 거른 대표 이름", async () => {
  const urls: URL[] = [];
  useFetch(
    fake<typeof fetch>(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === "/api/tags") return json({ items: [{ name: "rock", categoryName: "Genres" }, { name: "rock ballad" }, {}] });
      return json({ items: [{ id: 1, name: "初音ミク", artistType: "Vocaloid" }, { id: 2 }] });
    }),
  );

  assert.deepEqual(await suggest("vocadb", "tags", "roc"), [{ value: "rock", hint: "Genres" }, { value: "rock ballad" }]);
  assert.equal(urls[0].searchParams.get("nameMatchMode"), "StartsWith", "가운데가 맞는 것까지 주면 roc 에 rock 이 안 뜬다");
  assert.equal(urls[0].searchParams.get("sort"), "UsageCount");

  assert.deepEqual(await suggest("vocadb", "artists", "初音"), [{ value: "初音ミク", hint: "Vocaloid" }], "이름 없는 항목은 뺀다");
  const artists = urls[1].searchParams;
  assert.equal(artists.get("nameMatchMode"), "StartsWith");
  assert.ok(artists.get("artistTypes")?.split(",").includes("Vocaloid"), "후보에 뜬 것은 이름 풀기에서도 찾혀야 한다");

  await suggest("touhoudb", "artists", "ZU");
  assert.equal(urls[2].searchParams.get("artistTypes"), null, "touhoudb 는 거르지 않는다");
});
