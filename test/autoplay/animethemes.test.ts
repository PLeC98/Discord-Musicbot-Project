// src/autoplay/sources/animethemes.ts: AnimeThemes 소스(새 GraphQL API).
//
// 지키려는 계약:
// - 대사가 겹치지 않는 판본(overlap NONE)의 음원을 쓴다. 대사가 겹친 판본뿐이면 음원 없이 이름만(strict) 보낸다. 판본이 없으면 버린다
// - 같은 곡이 여러 작품, 시즌의 주제가일 수 있다. 겹침은 song.id로 막는다
// - 무작위는 종류, 매체(하나), 연도 구간을 서버에 넘기고 나머지(시즌, 양끝 시즌, 매체 여럿, 순번)는 받은 뒤 거른다
// - 가수는 공연자(Performance)만, relevance 순서로
// - 인기순은 상위 500개를 커서로 넘기며 받고 조건은 받은 뒤 거른다
// - GraphQL errors는 실패로 처리한다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { animethemes, POPULAR_DEPTH } from "../../src/autoplay/sources/animethemes.ts";
import { useFetch } from "../../src/autoplay/sources/http.ts";
import type { GenreSource } from "../../src/config/genres.ts";
import { fake } from "../helpers/fake.ts";

after(() => useFetch(null));

type Sent = { url: string; query: string; variables: Record<string, unknown> };

// 받은 요청(주소, 질의, 변수)을 남기고, 요청에 따라 응답(GraphQL 본문 전체)을 돌려준다
function serve(reply: (sent: Sent, index: number) => unknown) {
  const sent: Sent[] = [];
  useFetch(
    fake<typeof fetch>(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables?: Record<string, unknown> };
      const one = { url: String(input), query: body.query, variables: body.variables ?? {} };
      sent.push(one);
      return { ok: true, status: 200, json: async () => reply(one, sent.length - 1) };
    }),
  );
  return sent;
}

const source = (extra: Partial<GenreSource> = {}): GenreSource => ({ type: "animethemes", ...extra }) as GenreSource;
const video = (overlap: string, link: string) => ({ overlap, audio: { link } });
const anime = (extra: Record<string, unknown> = {}) => ({ slug: "work", siteUrl: "https://animethemes.moe/anime/work", year: 2020, season: "SPRING", format: "TV", title: { romaji: "작품" }, imagesV2: [], ...extra });
const theme = (songId: number | undefined, title: string, videos: Array<ReturnType<typeof video>>, extra: Record<string, unknown> = {}) => ({
  type: "OP",
  sequence: 1,
  anime: anime(),
  song: { id: songId, title: { romaji: title, native: null }, staff: [{ role: "Performance", relevance: 1, artist: { name: { main: "가수" } } }] },
  entries: [{ videos: { nodes: videos } }],
  ...extra,
});
const shuffled = (themes: unknown[]) => ({ data: { themeShuffle: themes } });

test("새 API에 POST로 요청한다. 대사가 겹친 판본만 있으면 음원 없이 이름만(strict), 깨끗한 판본이 있으면 그 음원, 판본이 없으면 버린다", async () => {
  const sent = serve(() => shuffled([theme(1, "대사만", [video("OVER", "https://a/1-over.ogg")]), theme(2, "섞임", [video("TRANS", "https://a/2-trans.ogg"), video("NONE", "https://a/2-clean.ogg")]), theme(3, "판본 없음", [])]));
  const got = await animethemes(source());
  assert.equal(sent[0].url, "https://rs.animethemes.moe/graphql");
  assert.deepEqual(
    got.map((c) => [c.title, c.audioUrl ?? null, c.strict ?? false]),
    [
      ["대사만", null, true],
      ["섞임", "https://a/2-clean.ogg", false],
    ],
  );
});

test("같은 곡은 한 번만. 겹침은 주제가가 아니라 곡 id로 막는다. 후보에는 이름, 큰 표지, 작품 주소, 곡 id 키를 담는다", async () => {
  const work = anime({
    imagesV2: [
      { facet: "SMALL_COVER", link: "https://i/s" },
      { facet: "LARGE_COVER", link: "https://i/l" },
    ],
  });
  serve(() => shuffled([theme(7, "같은 곡", [video("NONE", "https://a/7a.ogg")], { anime: work }), theme(7, "같은 곡", [video("NONE", "https://a/7b.ogg")], { anime: work, sequence: 2 })]));
  const [only, ...rest] = await animethemes(source({ themeType: "OP", yearFrom: 2000 }));
  assert.equal(rest.length, 0);
  assert.deepEqual(only, { artist: "가수", title: "같은 곡", audioUrl: "https://a/7a.ogg", thumbnail: "https://i/l", sourceUrl: "https://animethemes.moe/anime/work", platform: "animethemes", sourceKey: "at:7" });
});

test("가수는 공연자만 relevance 순서로. 없으면 작품 이름. 로마자 제목이 없으면 원어 제목", async () => {
  const staff = [
    { role: "Composition", relevance: 1, artist: { name: { main: "작곡가" } } },
    { role: "Performance", relevance: 2, artist: { name: { main: "둘째" } } },
    { role: "Performance", relevance: 1, artist: { name: { main: "첫째" } } },
  ];
  serve(() => shuffled([theme(1, "곡", [video("NONE", "https://a/1.ogg")], { song: { id: 1, title: { romaji: null, native: "曲" }, staff } }), theme(2, "곡2", [video("NONE", "https://a/2.ogg")], { song: { id: 2, title: { romaji: "곡2" }, staff: [] } })]));
  const got = await animethemes(source({ themeType: "OP", yearFrom: 2000 }));
  assert.deepEqual(
    got.map((c) => [c.title, c.artist]),
    [
      ["曲", "첫째, 둘째"],
      ["곡2", "작품"],
    ],
  );
});

test("곡 id가 없는 주제가는 뺀다(겹침도 출처 키도 가를 수 없다)", async () => {
  serve(() => shuffled([theme(undefined, "id 없음", [video("NONE", "https://a/x.ogg")]), theme(9, "id 있음", [video("NONE", "https://a/9.ogg")])]));
  const got = await animethemes(source({ themeType: "OP", yearFrom: 2000 }));
  assert.deepEqual(
    got.map((c) => [c.title, c.sourceKey]),
    [["id 있음", "at:9"]],
  );
});

test("무작위: 종류, 매체(하나), 연도 구간은 서버 조건으로. 저장된 옛 철자를 새 열거형으로 바꾼다. 종류를 안 고르면 OP, ED(삽입곡은 영상이 없다)", async () => {
  const sent = serve(() => shuffled([]));
  await animethemes(source({ themeType: "ED", mediaFormat: ["TV Short"], yearFrom: 2010, yearTo: 2015 }));
  assert.deepEqual(sent[0].variables, { first: 100, input: { type: ["ED"], format: "TV_SHORT", yearGte: 2010, yearLte: 2015 } });
  const plain = serve(() => shuffled([]));
  await animethemes(source({ mediaFormat: ["TV", "Movie"] }));
  assert.deepEqual(plain[0].variables, { first: 100, input: { type: ["OP", "ED"] } }, "매체가 여럿이면 서버에 넘기지 않는다");
});

test("받은 뒤 거른다: 시즌 여럿, 매체 여럿, 순번, 양끝 시즌", async () => {
  const at = (id: number, year: number, season: string, extra: Record<string, unknown> = {}) => theme(id, `${year} ${season} ${id}`, [video("NONE", `https://a/${id}.ogg`)], { anime: anime({ year, season, ...((extra.anime as object) ?? {}) }), ...extra });
  serve(() => shuffled([at(1, 2019, "FALL"), at(2, 2020, "WINTER"), at(3, 2020, "SPRING"), at(4, 2021, "SUMMER"), at(5, 2021, "FALL")]));
  const ranged = await animethemes(source({ yearFrom: 2020, seasonFrom: "Spring", yearTo: 2021, seasonTo: "Summer" }));
  assert.deepEqual(
    ranged.map((c) => c.sourceKey),
    ["at:3", "at:4"],
    "2020 겨울은 시작 분기 앞, 2021 가을은 끝 분기 뒤(2019 는 서버가 걸렀어야 하지만 와도 자른다)",
  );

  serve(() => shuffled([at(1, 2020, "SPRING", { sequence: 2 }), at(2, 2020, "FALL", { sequence: 2 }), at(3, 2020, "SPRING", { sequence: 1 }), at(4, 2020, "SPRING", { sequence: 2, anime: { format: "MOVIE" } }), at(5, 2020, "SPRING", { sequence: 2, type: "ED" })]));
  const narrowed = await animethemes(source({ themeType: "OP", season: ["Spring"], mediaFormat: ["TV", "OVA"], sequence: 2 }));
  assert.deepEqual(
    narrowed.map((c) => c.sourceKey),
    ["at:1"],
  );
});

test("양끝 분기를 안 적으면 그해 처음부터 끝까지", async () => {
  serve(() => shuffled([theme(1, "처음", [video("NONE", "https://a/1.ogg")], { anime: anime({ year: 2020, season: "WINTER" }) }), theme(2, "끝", [video("NONE", "https://a/2.ogg")], { anime: anime({ year: 2020, season: "FALL" }) })]));
  const got = await animethemes(source({ yearFrom: 2020, yearTo: 2020 }));
  assert.deepEqual(
    got.map((c) => c.title),
    ["처음", "끝"],
  );
});

test("거르고 20곡이 안 남으면 두 번까지 더 뽑는다. 넉넉하면 한 번", async () => {
  const many = Array.from({ length: 25 }, (_, i) => theme(100 + i, `곡${i}`, [video("NONE", `https://a/${i}.ogg`)]));
  const once = serve(() => shuffled(many));
  assert.equal((await animethemes(source())).length, 25);
  assert.equal(once.length, 1);

  const few = serve((_, i) => shuffled([theme(i + 1, `곡${i}`, [video("NONE", `https://a/${i}.ogg`)])]));
  assert.equal((await animethemes(source())).length, 3);
  assert.equal(few.length, 3);
});

test("인기순: 100개씩 커서로 넘겨 상위 500개까지. 조건은 받은 뒤 거른다", async () => {
  assert.equal(POPULAR_DEPTH, 500);
  const sent = serve((one, i) => ({
    data: {
      mostPopularEntries: {
        pageInfo: { hasNextPage: true, endCursor: `c${i + 1}` },
        nodes: Array.from({ length: 100 }, (_, n) => ({ theme: theme(i * 100 + n + 1, `곡${i * 100 + n}`, [video("NONE", "https://a/x.ogg")], { type: n % 2 ? "ED" : "OP" }) })),
      },
    },
  }));
  const got = await animethemes(source({ sort: "popular", themeType: "ED" }));
  assert.equal(sent.length, 5, "상위 500개에서 멈춘다");
  assert.deepEqual(
    sent.map((one) => one.variables.after),
    [null, "c1", "c2", "c3", "c4"],
  );
  assert.equal(got.length, 250, "ED 만");
  assert.ok(sent[0].query.includes("mostPopularEntries"));
});

test("인기순: 다음 쪽이 없으면 거기서 멈춘다", async () => {
  const sent = serve(() => ({ data: { mostPopularEntries: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ theme: theme(1, "곡", [video("NONE", "https://a/1.ogg")]) }] } } }));
  assert.equal((await animethemes(source({ sort: "popular" }))).length, 1);
  assert.equal(sent.length, 1);
});

test("GraphQL errors는 실패로 처리한다(200이어도)", async () => {
  serve(() => ({ data: null, errors: [{ message: "Validation failed for first" }] }));
  await assert.rejects(animethemes(source()), /Validation failed for first/);
});
