"use strict";

// src/autoplayRoute — 소스가 준 후보를 "틀 수 있는 트랙"으로 바꾸고, 소스를 훑어 한 곡을 고른다.
//
// 여기서 지키려는 것은 **어느 칸이 찼는지가 길을 정한다**는 규칙이다.
// 유튜브 검색은 실제로 하지 않는다 — require.cache로 YouTube를 갈아 끼운다.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// YouTube를 먼저 갈아 끼운다(라우터가 부를 때 이것을 집도록)
const ytPath = require.resolve("../src/YouTube");
let ytResults = [];
let ytCalls = [];
require.cache[ytPath] = {
  id: ytPath,
  filename: ytPath,
  loaded: true,
  exports: {
    search: async (query) => {
      ytCalls.push(query);
      return ytResults;
    },
  },
};

const route = require("../src/autoplayRoute");
const pool = require("../src/autoplayPool");

const LIMITS = require("../src/autoplayFilter").prepare({ minDurationSec: 60, maxDurationSec: 3600, blockedKeywords: ["mix", "playlist"] });

beforeEach(() => {
  pool._reset();
  ytResults = [];
  ytCalls = [];
});

// ── 어느 칸이 찼는지가 길을 정한다 ────────────────────────────────────────

test("유튜브 주소를 받았으면 검색하지 않는다", async () => {
  const track = await route.resolve({ title: "노래", durationSec: 200, youtubeUrl: "https://youtu.be/abc", sourceKey: "vocadb:1" }, LIMITS);
  assert.equal(track.url, "https://youtu.be/abc");
  assert.equal(ytCalls.length, 0, "주소가 있으면 유튜브를 검색할 이유가 없다");
});

test("유튜브 주소를 받은 것에는 필터를 건다 — 검색을 안 했으니 제목을 못 믿는다", async () => {
  assert.equal(await route.resolve({ title: "2시간 연속 재생 mix", durationSec: 200, youtubeUrl: "https://youtu.be/x" }, LIMITS), null);
  assert.equal(await route.resolve({ title: "긴 영상", durationSec: 9999, youtubeUrl: "https://youtu.be/y" }, LIMITS), null);
});

test("이름만 받았으면 유튜브에서 찾는다", async () => {
  ytResults = [{ id: "v1", url: "https://www.youtube.com/watch?v=v1", title: "Artist - Song", artist: "Artist", duration: 240 }];
  const track = await route.resolve({ artist: "Artist", title: "Song", sourceKey: "lf:1" }, LIMITS);
  assert.equal(track.url, "https://www.youtube.com/watch?v=v1");
  assert.ok(ytCalls.length > 0);
});

test("음원만 받았으면 그대로 튼다 — 출처가 곧 정답이라 필터가 없다", async () => {
  const track = await route.resolve({ artist: "", title: "주제가", audioUrl: "https://a.animethemes.moe/X-OP1.ogg", sourceKey: "at:9" }, LIMITS);
  assert.equal(track.platform, "direct");
  assert.equal(track.url, "https://a.animethemes.moe/X-OP1.ogg");
  // 길이는 받은 뒤 실측한다 — 미리 재지 않는다
  assert.equal(track.duration, 0);
  assert.equal(track.durationSource, "미상");
});

// ── AnimeThemes: 유튜브 풀버전 먼저, 안 되면 음원 ─────────────────────────

test("풀버전을 찾으면 유튜브를 쓴다", async () => {
  ytResults = [{ id: "v1", url: "https://www.youtube.com/watch?v=v1", title: "Artist - Song", artist: "Artist", duration: 260 }];
  const track = await route.resolve({ artist: "Artist", title: "Song", audioUrl: "https://a.animethemes.moe/X.ogg", sourceKey: "at:1" }, LIMITS);
  assert.equal(track.platform, "youtube");
});

test("찾은 것이 TV 사이즈 립이면 음원으로 떨어진다 — 음질만 나쁘고 단계만 는다", async () => {
  ytResults = [{ id: "v1", url: "https://www.youtube.com/watch?v=v1", title: "Artist - Song", artist: "Artist", duration: 91 }];
  const track = await route.resolve({ artist: "Artist", title: "Song", audioUrl: "https://a.animethemes.moe/X.ogg", sourceKey: "at:1" }, LIMITS);
  assert.equal(track.platform, "direct", `${route.FULL_SEC}초 미만이면 음원을 쓴다`);
});

test("유튜브에서 아무것도 못 찾아도 음원이 있으면 튼다", async () => {
  ytResults = [];
  const track = await route.resolve({ artist: "Artist", title: "Song", audioUrl: "https://a.animethemes.moe/X.ogg", sourceKey: "at:1" }, LIMITS);
  assert.equal(track.platform, "direct");
});

test("이름뿐인데 못 찾으면 null", async () => {
  ytResults = [];
  assert.equal(await route.resolve({ artist: "Artist", title: "Song", sourceKey: "lf:1" }, LIMITS), null);
});

// ── 표시 이름 ─────────────────────────────────────────────────────────────

// 회귀 대상: 유튜브 채널명을 아티스트 자리에 넣어 `lcozzarelli — Sarah Vaughan - Fever`처럼 나왔다.
// 채널명은 올린 사람이지 아티스트가 아니다. 우리가 그 곡을 찾아서 고른 것이므로 소스가 안다.
test("표시 이름은 소스 것을 앞세운다 — 유튜브 채널명은 아티스트가 아니다", async () => {
  // 올린 사람이 채널명(artist 칸)으로 오고, 영상 제목에는 군더더기가 붙어 있다
  ytResults = [{ id: "v1", url: "https://www.youtube.com/watch?v=v1", title: "Sarah Vaughan - Fever (HQ audio)", artist: "lcozzarelli", duration: 240 }];

  const track = await route.resolve({ artist: "Sarah Vaughan", title: "Fever", durationSec: 240, sourceKey: "lb:1" }, LIMITS);
  assert.equal(track.artist, "Sarah Vaughan");
  assert.equal(track.title, "Fever");
});

test("소스가 이름을 모르면 영상 쪽을 쓴다 — 키워드·유튜브 재생목록이 그렇다", async () => {
  const track = await route.resolve({ title: "어느 영상", durationSec: 200, youtubeUrl: "https://youtu.be/z" }, LIMITS);
  assert.equal(track.title, "어느 영상");
});

// ── 중복 회피 ─────────────────────────────────────────────────────────────

test("최근에 튼 곡은 이름으로도 걸러낸다 — 소스가 다르면 주소가 다르기 때문이다", () => {
  const reject = route.rejector([{ artist: "YOASOBI", title: "Idol", url: "https://www.youtube.com/watch?v=a" }]);
  assert.equal(reject({ artist: "yoasobi", title: "  IDOL " }), true, "대소문자·공백은 같은 곡으로 본다");
  assert.equal(reject({ artist: "YOASOBI", title: "Racing Into The Night" }), false);
});

test("주소가 같아도 걸러낸다", () => {
  const reject = route.rejector([{ title: "x", url: "https://youtu.be/same" }]);
  assert.equal(reject({ title: "다른 제목", youtubeUrl: "https://youtu.be/same" }), true);
});

// ── 소스 훑기 ─────────────────────────────────────────────────────────────

test("무게대로 훑되 모든 소스를 한 번씩 거친다 — 목록이 곧 폴백 사슬이다", () => {
  const list = [{ type: "a", weight: 5 }, { type: "b", weight: 1 }, { type: "c" }];
  const seen = [...route._byWeight(list)].map((s) => s.type);
  assert.equal(seen.length, 3);
  assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
});

test("쓸 수 있는 소스가 없으면 null — 아무거나 틀지 않는다", async () => {
  assert.equal(await route.pickTrack({ sources: [] }), null);
  assert.equal(await route.pickTrack({ sources: [{ type: "없는소스" }] }), null);
});

test("앞 소스가 빈 손이면 다음 소스로 넘어간다", async () => {
  ytResults = [{ id: "v1", url: "https://www.youtube.com/watch?v=v1", title: "Song", artist: "Artist", duration: 240 }];
  const cfg = {
    minDurationSec: 60,
    maxDurationSec: 3600,
    blockedKeywords: [],
    // keyword는 위에서 갈아 끼운 YouTube.search를 타므로 곡이 나온다.
    // 앞의 lastfm은 키가 없어 usable이 false라 아예 후보에서 빠진다.
    sources: [
      { type: "lastfm", tags: ["pop"], weight: 9 },
      { type: "keyword", keywords: ["아무거나"] },
    ],
  };
  const track = await route.pickTrack(cfg, []);
  assert.ok(track, "키가 없는 소스는 건너뛰고 남은 소스로 골라야 한다");
  assert.equal(track.platform, "youtube");
});
