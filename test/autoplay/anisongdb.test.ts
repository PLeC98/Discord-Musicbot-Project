// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// AnisongDB 소스. 설정 한 줄이 저쪽 filters 로 어떻게 바뀌는가.
//
// 지키려는 계약:
//  · 보내는 값은 소문자. 받은 값을 되보내면 422
//  · 안 적은 칸은 아예 뺀다. 빈 배열은 422
//  · include_no_difficulty 를 켜지 않는다. 난이도 0 은 결측이다
//  · 삽입곡은 기본으로 꺼져 있다

import { test } from "node:test";
import assert from "node:assert/strict";

import * as sources from "../../src/autoplay/sources/index.ts";
const build = sources._anisongFilters;

// ── 기본값 ────────────────────────────────────────────────────────────────

test("아무것도 안 적으면 OP/ED · standard · normal · 음원 있음", () => {
  const f = build({});
  assert.deepEqual(f.song_types, ["opening", "ending"], "삽입곡은 기본으로 끈다");
  assert.deepEqual(f.song_categories, ["standard"], "Instrumental 은 자동재생에 안 맞는다");
  assert.deepEqual(f.broadcasts, ["normal"]);
  // require_any 는 OR. 영상만 있는 곡을 버리지 않는다(최신 분기에서 넷 중 하나꼴이다)
  assert.deepEqual(f.media_links, { require_any: ["audio", "HQ"] });
});

test("안 적은 칸은 아예 없다 — 빈 배열을 보내면 422다", () => {
  const f = build({});
  for (const key of ["anime_types", "genres", "tags", "difficulty", "season"]) {
    assert.ok(!(key in f), `${key} 는 없어야 한다`);
  }
});

// 난이도 0·null 은 값이 아니라 결측이다. 켜면 그 곡들이 들어온다.
test("include_no_difficulty 를 켜지 않는다", () => {
  for (const source of [{}, { difficultyFrom: 50 }, { difficultyFrom: 0, difficultyTo: 100 }]) {
    const f = build(source);
    assert.equal(f.difficulty?.include_no_difficulty, undefined);
  }
});

// ── 소문자 ────────────────────────────────────────────────────────────────

// 응답은 "Standard" 인데 요청은 "standard" 여야 한다.
test("받은 대문자를 그대로 되보내지 않는다", () => {
  const f = build({ songTypes: ["Opening"], songCategories: ["Standard", "Instrumental"], broadcasts: ["Normal", "Rebroadcast"], animeTypes: ["TV", "Movie"] });
  assert.deepEqual(f.song_types, ["opening"]);
  assert.deepEqual(f.song_categories, ["standard", "instrumental"]);
  assert.deepEqual(f.broadcasts, ["normal", "rebroadcast"]);
  assert.deepEqual(f.anime_types, ["tv", "movie"]);
});

test("모르는 값은 버리고 기본값으로 돌아간다 — 422로 소스가 조용히 죽는 것보다 낫다", () => {
  const f = build({ songTypes: ["오프닝"], broadcasts: ["없는값"] });
  assert.deepEqual(f.song_types, ["opening", "ending"]);
  assert.deepEqual(f.broadcasts, ["normal"]);
});

// ── 난이도 ────────────────────────────────────────────────────────────────

test("난이도는 양끝을 다 싣는다", () => {
  assert.deepEqual(build({ difficultyFrom: 40, difficultyTo: 60 }).difficulty, { start: 40, end: 60 });
});

test("한쪽만 적으면 반대쪽은 끝까지", () => {
  assert.deepEqual(build({ difficultyFrom: 50 }).difficulty, { start: 50, end: 100 });
  assert.deepEqual(build({ difficultyTo: 30 }).difficulty, { start: 1, end: 30 });
});

// 0 은 값이 아니라 결측 표시다.
test("하한 0 은 1 로 올린다", () => {
  assert.deepEqual(build({ difficultyFrom: 0, difficultyTo: 100 }).difficulty, { start: 1, end: 100 });
});

test("100을 넘겨도 100에서 멈춘다", () => {
  assert.deepEqual(build({ difficultyFrom: 120, difficultyTo: 999 }).difficulty, { start: 100, end: 100 });
});

// ── 분기 ──────────────────────────────────────────────────────────────────

// AnimeThemes 는 시즌 범위 문법이 없어 우리가 걸러냈다. 저쪽은 범위를 받는다.
test("분기는 저쪽이 범위로 받으므로 우리가 자르지 않는다", () => {
  assert.deepEqual(build({ yearFrom: 2024, seasonFrom: "Spring", yearTo: 2026, seasonTo: "Summer" }).season, { start: "Spring 2024", end: "Summer 2026" });
});

test("분기를 안 적으면 그 해 처음부터 끝까지", () => {
  assert.deepEqual(build({ yearFrom: 2020, yearTo: 2021 }).season, { start: "Winter 2020", end: "Fall 2021" });
});

test("분기만 적고 연도가 없으면 무시한다 — 연도 없는 분기는 뜻이 없다", () => {
  assert.equal(build({ seasonFrom: "Summer" }).season, undefined);
});

// ── 장르·태그 ─────────────────────────────────────────────────────────────

test("장르와 태그는 require_any 로 싣는다", () => {
  const f = build({ genres: ["Comedy", "Action"], tags: ["Idol", "School"] });
  assert.deepEqual(f.genres, { require_any: ["Comedy", "Action"] });
  assert.deepEqual(f.tags, { require_any: ["Idol", "School"] });
});

// Idol·School 은 태그이고 장르가 아니다. 장르 칸에 넣으면 422 가 온다.
// SPEC 의 enums 가 설정 시점에 잡는다.
test("장르 목록에 태그 이름이 섞여 있지 않다", () => {
  const { SPEC } = sources;
  const genres = SPEC.anisongdb.enums.genres;
  assert.equal(genres.length, 18);
  for (const tagOnly of ["Idol", "School", "Isekai", "Shounen"]) {
    assert.ok(!genres.includes(tagOnly), `${tagOnly} 는 태그다`);
  }
  for (const real of ["Comedy", "Action", "Mahou Shoujo"]) {
    assert.ok(genres.includes(real), `${real} 는 장르다`);
  }
});

// ── 목록 캐시 ─────────────────────────────────────────────────────────────

// 0칸은 난이도가 아니라 결측이다. 그대로 그리면 왼쪽 끝에 없는 봉우리가 생긴다.
test("난이도 분포에서 0칸을 뺀다", async () => {
  const real = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      songs_by_genre: { Comedy: 17494, Action: 13808 },
      songs_by_tag: { School: 8787, Idol: 5489 },
      songs_by_difficulty: [608, 22, 43, 78],
      songs_by_season: { "Winter 1924": 1, "Summer 2026": 175 },
    }),
  });
  try {
    sources._seedAnisongStats(null);
    const got = await sources._anisongCatalog();
    assert.deepEqual(got.difficulty, [22, 43, 78], "608(결측)이 빠져야 한다");
    assert.deepEqual(got.genres, ["Comedy", "Action"]);
    assert.deepEqual(got.tags, ["School", "Idol"]);
    assert.equal(got.min, 1924);
    assert.equal(got.max, 2026);
  } finally {
    global.fetch = real;
    sources._seedAnisongStats(null);
  }
});

test("목록을 못 받아도 던지지 않는다 — 칸이 안 그려지는 것보다 빈 목록이 낫다", async () => {
  const real = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, text: async () => "" });
  try {
    sources._seedAnisongStats(null);
    assert.equal(await sources._anisongCatalog(), null);
  } finally {
    global.fetch = real;
  }
});

// ── 후보 모양 ─────────────────────────────────────────────────────────────

// 가짜 fetch. AnisongDB 와 AniList 를 부르는 순서대로 답한다.
function stub({ songs, covers = [], anilistFails = false }) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    if (String(url).includes("anilist")) {
      if (anilistFails) return { ok: false, status: 429, text: async () => "" };
      return { ok: true, json: async () => ({ data: { Page: { media: covers } } }) };
    }
    return { ok: true, json: async () => songs };
  };
  return { calls, restore: () => (global.fetch = real) };
}

const song = (over = {}) => ({ songName: "곡", songArtist: "아티스트", amqSongId: 1, annSongId: 10, annId: 100, audio: "abc.mp3", linked_ids: { anilist: 7 }, ...over });

test("후보 모양 — 음원 주소·출처·열쇠", async () => {
  const s = stub({ songs: [song()], covers: [{ id: 7, coverImage: { extraLarge: "https://cover/7.jpg" } }] });
  try {
    const [cand] = await sources.fetchFrom({ type: "anisongdb" });
    assert.equal(cand.sourceKey, "amq:1", "annSongId 가 아니라 amqSongId");
    assert.equal(cand.platform, "anisongdb");
    assert.equal(cand.audioUrl, "https://nawdist.animemusicquiz.com/abc.mp3");
    assert.equal(cand.sourceUrl, "https://anilist.co/anime/7");
    assert.equal(cand.thumbnail, "https://cover/7.jpg");
    assert.equal(cand.durationSec, undefined, "songLength 를 길이로 싣으면 매칭이 망가진다");
    assert.ok(!("_anilist" in cand), "속 값이 새어 나가면 안 된다");
  } finally {
    s.restore();
  }
});

// 같은 곡이 속편·OVA·극장판에 다시 쓰인다. annSongId 로 막으면 그것들이 다 따로 센다.
test("amqSongId 가 같으면 한 번만 낸다", async () => {
  const s = stub({ songs: [song({ annSongId: 10 }), song({ annSongId: 11 }), song({ amqSongId: 2, annSongId: 12 })] });
  try {
    const got = await sources.fetchFrom({ type: "anisongdb" });
    assert.deepEqual(
      got.map((c) => c.sourceKey),
      ["amq:1", "amq:2"],
    );
  } finally {
    s.restore();
  }
});

test("음원이 없으면 영상 주소로 떨어진다", async () => {
  const s = stub({ songs: [song({ audio: null, HQ: "v.webm" }), song({ amqSongId: 2, audio: null, HQ: null, MQ: "m.webm" })] });
  try {
    const got = await sources.fetchFrom({ type: "anisongdb" });
    assert.equal(got.length, 1, "MQ 는 쓰지 않는다. 있는 곡이 적어 후보가 훅 준다");
    assert.match(got[0].audioUrl, /\/v\.webm$/);
  } finally {
    s.restore();
  }
});

// 음원 주소가 캐시 장부의 열쇠이자 최근 재생 판정에 쓰인다. 섞이면 같은 곡이 두 칸으로 갈린다.
test("음원 호스트가 하나로 고정된다", async () => {
  const s = stub({ songs: [song(), song({ amqSongId: 2, audio: "b.mp3" }), song({ amqSongId: 3, audio: "c.mp3" })] });
  try {
    const got = await sources.fetchFrom({ type: "anisongdb" });
    assert.equal(new Set(got.map((c) => new URL(c.audioUrl).host)).size, 1);
  } finally {
    s.restore();
  }
});

test("AniList ID 가 없으면 ANN 주소를 쓴다", async () => {
  const s = stub({ songs: [song({ linked_ids: { anilist: null } })] });
  try {
    const [cand] = await sources.fetchFrom({ type: "anisongdb" });
    assert.equal(cand.sourceUrl, "https://www.animenewsnetwork.com/encyclopedia/anime.php?id=100");
    assert.equal(cand.thumbnail, null);
  } finally {
    s.restore();
  }
});

// AniList 는 분당 30회다. 곡마다 치면 닿는다.
test("표지는 묶어서 묻는다 — 곡마다 치지 않는다", async () => {
  const songs = Array.from({ length: 120 }, (_, i) => song({ amqSongId: i, linked_ids: { anilist: i } }));
  const s = stub({ songs });
  try {
    await sources.fetchFrom({ type: "anisongdb" });
    const toAniList = s.calls.filter((c) => c.url.includes("anilist"));
    assert.equal(toAniList.length, 3, "120개면 50씩 세 번");
    assert.ok(toAniList.every((c) => c.body.variables.ids.length <= 50));
  } finally {
    s.restore();
  }
});

test("표지를 못 받아도 곡은 낸다", async () => {
  const s = stub({ songs: [song()], anilistFails: true });
  try {
    const [cand] = await sources.fetchFrom({ type: "anisongdb" });
    assert.equal(cand.thumbnail, null);
    assert.equal(cand.sourceKey, "amq:1");
  } finally {
    s.restore();
  }
});
