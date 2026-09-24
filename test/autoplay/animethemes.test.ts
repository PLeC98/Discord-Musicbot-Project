// src/autoplay/sources/animethemes.ts — AnimeThemes 소스.
//
// 지키려는 계약:
//  · 대사가 얹힌 판본(overlap 이 None 이 아닌 것)만 있는 곡은 버린다. 깨끗한 판본이 있으면 그것을 쓴다
//  · 같은 곡이 여러 작품 · 시즌의 주제가일 수 있다. 겹침은 song.id 로 막는다
//  · 연도 · 시즌 조건은 anime 쪽에 걸고, 양끝 시즌은 받은 뒤 우리가 자른다
//  · 종류(OP · ED)와 순번이 맞는 주제가만

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { animethemes } from "../../src/autoplay/sources/animethemes.ts";
import { useFetch } from "../../src/autoplay/sources/http.ts";
import type { GenreSource } from "../../src/config/genres.ts";
import { fake } from "../helpers/fake.ts";

after(() => useFetch(null));

// 받은 주소를 남기고, 주소에 따라 응답을 고른다
function serve(reply: (url: string) => unknown) {
  const urls: string[] = [];
  useFetch(
    fake<typeof fetch>(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      return { ok: true, status: 200, json: async () => reply(url) };
    }),
  );
  return urls;
}

const source = (extra: Partial<GenreSource> = {}): GenreSource => ({ type: "animethemes", ...extra }) as GenreSource;
const video = (overlap: string, link: string) => ({ overlap, audio: { link } });
const theme = (songId: number, title: string, videos: Array<ReturnType<typeof video>>, extra: Record<string, unknown> = {}) => ({
  type: "OP",
  sequence: 1,
  song: { id: songId, title, artists: [{ name: "가수" }] },
  animethemeentries: [{ videos }],
  ...extra,
});

test("대사가 얹힌 판본만 있으면 버리고, 깨끗한 판본이 있으면 그것을 쓴다", async () => {
  serve(() => ({
    animethemes: [theme(1, "대사만 있음", [video("Over", "https://a/1-over.ogg")]), theme(2, "섞여 있음", [video("Transition", "https://a/2-trans.ogg"), video("None", "https://a/2-clean.ogg")]), theme(3, "판본 정보 없음", [])],
  }));
  const got = await animethemes(source());
  assert.deepEqual(
    got.map((c) => [c.title, c.audioUrl]),
    [["섞여 있음", "https://a/2-clean.ogg"]],
  );
});

test("같은 곡은 한 번만. 겹침은 주제가가 아니라 곡 id 로 막는다", async () => {
  const anime = {
    name: "작품",
    slug: "work",
    images: [
      { facet: "Small Cover", link: "https://i/s" },
      { facet: "Large Cover", link: "https://i/l" },
    ],
  };
  serve(() => ({
    animethemes: [theme(7, "같은 곡", [video("None", "https://a/7a.ogg")], { anime }), theme(7, "같은 곡", [video("None", "https://a/7b.ogg")], { anime, sequence: 2 })],
  }));
  const [only, ...rest] = await animethemes(source());
  assert.equal(rest.length, 0);
  assert.deepEqual(only, {
    artist: "가수",
    title: "같은 곡",
    audioUrl: "https://a/7a.ogg",
    thumbnail: "https://i/l",
    sourceUrl: "https://animethemes.moe/anime/work",
    platform: "animethemes",
    sourceKey: "at:7",
  });
});

test("조건이 없으면 주제가를 무작위로 한 번 묻는다. 종류 · 순번은 저쪽 필터로", async () => {
  const urls = serve(() => ({ animethemes: [] }));
  await animethemes(source({ themeType: "ED", sequence: 2 }));
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/animetheme");
  assert.equal(url.searchParams.get("sort"), "random");
  assert.equal(url.searchParams.get("filter[type]"), "ED");
  assert.equal(url.searchParams.get("filter[sequence]"), "2");
});

test("연도를 걸면 작품 쪽에 묻고, 양끝 시즌 밖의 작품은 우리가 자른다", async () => {
  const anime = (year: number, season: string, themes = [theme(year * 10 + season.length, `${year} ${season}`, [video("None", `https://a/${year}${season}.ogg`)])]) => ({
    name: "작품",
    year,
    season,
    animethemes: themes,
  });
  const urls = serve(() => ({ anime: [anime(2019, "Fall"), anime(2020, "Winter"), anime(2020, "Spring"), anime(2021, "Summer"), anime(2021, "Fall")] }));
  const got = await animethemes(source({ yearFrom: 2020, seasonFrom: "Spring", yearTo: 2021, seasonTo: "Summer" }));

  const url = new URL(urls[0]);
  assert.equal(url.pathname, "/anime", "연도는 animetheme 쪽에 걸면 조용히 무시된다");
  assert.equal(url.searchParams.get("filter[year-gte]"), "2020");
  assert.equal(url.searchParams.get("filter[year-lte]"), "2021");
  assert.deepEqual(
    got.map((c) => c.title),
    ["2020 Spring", "2021 Summer"],
    "2020 겨울은 시작 시즌 앞, 2021 가을은 끝 시즌 뒤",
  );
});

test("양끝 시즌을 안 적으면 그해 처음부터 끝까지", async () => {
  serve(() => ({
    anime: [
      { year: 2020, season: "Winter", animethemes: [theme(1, "처음", [video("None", "https://a/1.ogg")])] },
      { year: 2020, season: "Fall", animethemes: [theme(2, "끝", [video("None", "https://a/2.ogg")])] },
    ],
  }));
  const got = await animethemes(source({ yearFrom: 2020, yearTo: 2020 }));
  assert.deepEqual(
    got.map((c) => c.title),
    ["처음", "끝"],
  );
});

test("작품 쪽으로 물었을 때 종류와 순번이 맞는 주제가만", async () => {
  serve(() => ({
    anime: [
      {
        year: 2020,
        season: "Spring",
        animethemes: [theme(1, "OP1", [video("None", "https://a/1.ogg")]), theme(2, "OP2", [video("None", "https://a/2.ogg")], { sequence: 2 }), theme(3, "ED1", [video("None", "https://a/3.ogg")], { type: "ED" })],
      },
    ],
  }));
  const got = await animethemes(source({ yearFrom: 2020, themeType: "OP", sequence: 2 }));
  assert.deepEqual(
    got.map((c) => c.title),
    ["OP2"],
  );
});
