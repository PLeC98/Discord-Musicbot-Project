// src/autoplayRoute — 소스가 준 후보를 "틀 수 있는 트랙"으로 바꾸고, 소스를 훑어 한 곡을 고른다.
//
// 여기서 지키려는 것은 어느 필드가 찼는지가 길을 정한다는 규칙이다.
// 바깥 경계(소스 · 유튜브 검색 · 링크 데이터 · AI 보조)는 넘겨 준다. 진짜로 부르지 않는다.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as route from "../../src/autoplay/route.ts";
import type { Candidate } from "../../src/autoplay/sources/candidate.ts";
import type { GenreSource } from "../../src/config/genres.ts";
import type { Limits } from "../../src/autoplay/filter.ts";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";
import * as sources from "../../src/autoplay/sources/index.ts";
import { withConfig } from "../helpers/config.ts";
import * as pool from "../../src/autoplay/pool.ts";

import * as filterModule from "../../src/autoplay/filter.ts";
const LIMITS = filterModule.prepare({ minDurationSec: 60, maxDurationSec: 3600, blockedKeywords: ["mix", "playlist"] });

// 가짜 검색 결과. 진짜 검색이 주는 필드 중 여기서 쓰는 것만
type Found = { id: string; audioUrl?: string; url?: string; title: string; artist: string; duration: number; thumbnail?: string };
let ytResults: Found[] = [];
let ytCalls: string[] = [];
const ledger = new Map<string, { audioUrl: string; durationSec?: number }>();
// 소스는 검색어가 있는 keyword 만 흉내 낸다: ytResults 를 검색 결과 후보로
const deps: route.Deps = {
  search: async (query) => {
    ytCalls.push(query);
    return ytResults;
  },
  known: (requestKey) => ledger.get(requestKey) ?? null, // { audioUrl, durationSec? }
  fetch: async (source: GenreSource) => (source.type === "keyword" && source.keywords?.length ? ytResults.map((r) => ({ title: r.title, durationSec: r.duration, youtubeUrl: r.audioUrl, fromSearch: true, sourceKey: `yt:${r.id}` })) : []),
  assist: { filter: async (candidates) => candidates, accepts: async () => true },
};
const resolve = (cand: Candidate, limits: Limits) => route.resolve(cand, limits, undefined, deps);
const pick = (cfg: route.PickConfig, recent: Parameters<typeof route.pickTrack>[1] = []) => route.pickTrack(cfg, recent, deps);
// 트랙이 나와야 하는 테스트용
async function resolved(cand: Candidate, limits: Limits) {
  const track = await resolve(cand, limits);
  assert.ok(track, "트랙을 만들지 못했다");
  return track;
}
async function picked(cfg: route.PickConfig, recent: Parameters<typeof route.pickTrack>[1] = []) {
  const track = await pick(cfg, recent);
  assert.ok(track, "곡을 고르지 못했다");
  return track;
}

beforeEach(() => {
  pool._reset();
  ytResults = [];
  ytCalls = [];
  ledger.clear();
});

// ── 어느 필드가 찼는지가 길을 정한다 ────────────────────────────────────────

test("유튜브 주소를 받았으면 검색하지 않는다", async () => {
  const track = await resolved({ title: "노래", durationSec: 200, youtubeUrl: "https://youtu.be/abc", sourceKey: "vocadb:1" }, LIMITS);
  assert.equal(track.audioUrl, "https://www.youtube.com/watch?v=abc");
  assert.equal(ytCalls.length, 0, "주소가 있으면 유튜브를 검색할 이유가 없다");
});

test("출처 · 영상 모두 제목이 없으면 곡 제목을 비워 둔다(null)", async () => {
  const track = await resolved({ title: "", durationSec: 200, youtubeUrl: "https://youtu.be/abd", sourceKey: "vocadb:2" }, LIMITS);
  assert.equal(track.title, null);
});

test("유튜브 주소를 받은 것에는 필터를 건다 — 검색을 안 했으니 제목을 못 믿는다", async () => {
  assert.equal(await resolve({ title: "2시간 연속 재생 mix", durationSec: 200, youtubeUrl: "https://youtu.be/x", sourceKey: "yt:x" }, LIMITS), null);
  assert.equal(await resolve({ title: "긴 영상", durationSec: 9999, youtubeUrl: "https://youtu.be/y", sourceKey: "yt:y" }, LIMITS), null);
});

test("이름만 받았으면 유튜브에서 찾는다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Artist - Song", artist: "Artist", duration: 240 }];
  const track = await resolved({ artist: "Artist", title: "Song", sourceKey: "lf:1" }, LIMITS);
  assert.equal(track.audioUrl, "https://www.youtube.com/watch?v=v1");
  assert.ok(ytCalls.length > 0);
});

test("음원만 받았으면 그대로 튼다 — 출처가 곧 정답이라 필터가 없다", async () => {
  const track = await resolved({ artist: "", title: "주제가", audioUrl: "https://a.animethemes.moe/X-OP1.ogg", sourceKey: "at:9" }, LIMITS);
  assert.equal(track.platform, "direct");
  assert.equal(track.audioUrl, "https://a.animethemes.moe/X-OP1.ogg");
  // 길이는 다운로드한 뒤 실측한다 — 미리 재지 않는다
  assert.equal(track.duration, 0);
  assert.equal(track.durationSource, "unknown");
});

// ── AnimeThemes: 유튜브 풀버전 먼저, 안 되면 음원 ─────────────────────────

test("풀버전을 찾으면 유튜브를 쓴다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Artist - Song", artist: "Artist", duration: 260 }];
  const track = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://a.animethemes.moe/X.ogg", sourceKey: "at:1" }, LIMITS);
  assert.equal(track.platform, "youtube");
});

test("찾은 것이 TV 사이즈 립이면 음원으로 떨어진다 — 음질만 나쁘고 단계만 는다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Artist - Song", artist: "Artist", duration: 91 }];
  const track = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://a.animethemes.moe/X.ogg", sourceKey: "at:1" }, LIMITS);
  assert.equal(track.platform, "direct", `${route.FULL_SEC}초 미만이면 음원을 쓴다`);
});

// 회귀 대상: 애니송 DB 는 길이를 안 실어 보내고 가수 이름이 채널명과 같은 일도 드물다.
// 그래서 확신 high 로 가는 길이 전부 막히고 "정크 단어가 없는 검색 1위"만으로 medium 이
// 붙어 엉뚱한 영상이 지나갔다. 음원을 이미 쥐고 있을 때는 그만큼으로는 부족하다.
test("음원이 있는데 찾은 영상 제목에 곡 제목이 없으면 음원으로 떨어진다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "다른 곡입니다", artist: "아무 채널", duration: 260 }];
  const track = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3", sourceKey: "amq:1" }, LIMITS);
  assert.equal(track.platform, "direct");
  assert.equal(track.audioUrl, "https://nawdist.animemusicquiz.com/a.mp3");
});

// 길이를 모르는 채로도 제목이 들어 있으면 바꾼다. 이것까지 막으면 풀버전을 통째로 포기하는 셈이다.
test("음원이 있어도 영상 제목에 곡 제목이 들어 있으면 유튜브를 쓴다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Song / Artist", artist: "아무 채널", duration: 260 }];
  const track = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3", sourceKey: "amq:2" }, LIMITS);
  assert.equal(track.platform, "youtube");
});

test("유튜브에서 아무것도 못 찾아도 음원이 있으면 튼다", async () => {
  ytResults = [];
  const track = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://a.animethemes.moe/X.ogg", sourceKey: "at:1" }, LIMITS);
  assert.equal(track.platform, "direct");
});

test("이름뿐인데 못 찾으면 null", async () => {
  ytResults = [];
  assert.equal(await resolve({ artist: "Artist", title: "Song", sourceKey: "lf:1" }, LIMITS), null);
});

// ── 표시 이름 ─────────────────────────────────────────────────────────────

// 회귀 대상: 유튜브 채널명을 아티스트 필드에 넣어 `lcozzarelli — Sarah Vaughan - Fever`처럼 나왔다.
// 채널명은 올린 사람이지 아티스트가 아니다. 우리가 그 곡을 찾아서 고른 것이므로 소스가 안다.
test("표시 이름은 소스 것을 앞세운다 — 유튜브 채널명은 아티스트가 아니다", async () => {
  // 올린 사람이 채널명(artist 필드)으로 오고, 영상 제목에는 군더더기가 붙어 있다
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Sarah Vaughan - Fever (HQ audio)", artist: "lcozzarelli", duration: 240 }];

  const track = await resolved({ artist: "Sarah Vaughan", title: "Fever", durationSec: 240, sourceKey: "lb:1" }, LIMITS);
  assert.equal(track.artist, "Sarah Vaughan");
  assert.equal(track.title, "Fever");
});

test("소스가 이름을 모르면 영상 쪽을 쓴다 — 키워드·유튜브 재생목록이 그렇다", async () => {
  const track = await resolved({ title: "어느 영상", durationSec: 200, youtubeUrl: "https://youtu.be/z", sourceKey: "yt:z" }, LIMITS);
  assert.equal(track.title, "어느 영상");
});

// ── 출처와 소리를 나눠 쥔다 ───────────────────────────────────────────────

// 회귀 대상: 출처에서 받아 온 곡을 `platform: "youtube"` + 영상 주소로 만들었더니,
// 링크 데이터(track_lookup)의 그 영상 행에 우리 이름이 덮였다. 나중에 누가 그 영상을 직접 틀면
// resolveFromCache가 우리가 써 둔 이름을 돌려준다. 게다가 TrackDownloader가 유튜브 트랙의
// 제목을 영상 제목으로 되돌려 놓아 "소스 것을 앞세운다"가 무위로 돌아간다.
//
// 스포티파이가 이미 같은 처지이고 이 저장소는 그것을 이렇게 푼다 —
// 보여 줄 링크와 platform은 출처 것, 영상은 음원 주소로 나눠 쓴다.
test("출처가 있는 곡은 주소도 platform도 출처 것이다 — 소리만 유튜브에서 온다", async () => {
  const track = await resolved(
    {
      title: "絶対零度フェスティバル",
      artist: "DIVELA feat. 初音ミク",
      durationSec: 213,
      youtubeUrl: "https://www.youtube.com/watch?v=4mMzhyUczic",
      sourceUrl: "https://vocadb.net/S/757470",
      platform: "vocadb",
      sourceKey: "vocadb:757470",
    },
    LIMITS,
  );

  assert.equal(track.platform, "vocadb", "유튜브 행세를 하면 링크 데이터의 영상 필드를 덮는다");
  assert.equal(track.pageUrl, "https://vocadb.net/S/757470");
  assert.equal(track.requestKey, "vocadb:757470", "링크 데이터에 우리 행이 따로 생겨야 한다");
  assert.equal(track.audioUrl, "https://www.youtube.com/watch?v=4mMzhyUczic");
  assert.equal(audioKeyOf(track.audioUrl), "yt:4mMzhyUczic", "음원 파일은 영상 기준으로 함께 쓴다");
});

test("출처가 없으면 영상 자체가 출처다 — 키워드·유튜브 재생목록", async () => {
  const track = await resolved({ title: "어느 영상", durationSec: 200, youtubeUrl: "https://www.youtube.com/watch?v=abcdefg", sourceKey: "yt:abcdefg" }, LIMITS);

  assert.equal(track.platform, "youtube");
  assert.equal(track.pageUrl, "https://www.youtube.com/watch?v=abcdefg");
  assert.equal(track.audioUrl, track.pageUrl, "영상이 곧 출처라 보여 줄 링크와 음원이 같다");
  assert.equal(audioKeyOf(track.audioUrl), "yt:abcdefg");
});

test("음원을 직접 트는 곡은 DirectLink와 같은 규약으로 캐시된다", async () => {
  const track = await resolved({ title: "주제가", artist: "누군가", audioUrl: "https://a.animethemes.moe/X-OP1.ogg", sourceKey: "at:9" }, LIMITS);

  assert.match(String(audioKeyOf(track.audioUrl)), /^dl:[0-9a-f]{32}$/);
  // getInfo를 안 거치므로 제목이 파일명이 되거나 아티스트가 비지 않는다
  assert.equal(track.title, "주제가");
  assert.equal(track.artist, "누군가");
});

// 회귀 대상: 로그가 음원으로 떨어진 곡을 "→ 유튜브"로 적고 있었다. platform 으로 구분하려 했는데
// 음원을 직접 트는 곡도 platform 은 출처 이름이라 그 판정은 어느 소스에서도 참이 되지 않는다.
// 소리가 어디서 오는지는 음원 주소로만 구분한다.
test("음원으로 떨어져도 platform 은 출처 이름이다 — 소리의 출생은 음원 주소로 구분한다", async () => {
  ytResults = [];
  const cand = { artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3", platform: "anisongdb", sourceKey: "amq:1" };
  const track = await resolved(cand, LIMITS);
  assert.equal(track.platform, "anisongdb", "임베드 라벨이 출처로 나와야 한다");
  assert.ok(audioKeyOf(track.audioUrl)?.startsWith("dl:"), "소리는 음원에서 온다");
});

// 같은 소스가 유튜브로 올라갔을 때는 반대다. platform 은 그대로고 키만 바뀐다.
test("유튜브로 올라가도 platform 은 그대로다 — 키가 yt: 로 바뀐다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Song / Artist", artist: "아무 채널", duration: 260 }];
  const cand = { artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3", sourceUrl: "https://anilist.co/anime/1", platform: "anisongdb", sourceKey: "amq:2" };
  const track = await resolved(cand, LIMITS);
  assert.equal(track.platform, "anisongdb");
  assert.equal(audioKeyOf(track.audioUrl), "yt:v1");
});

// ── 링크 필드 셋 ───────────────────────────────────────────────────────────

test("링크 필드 셋: 보여 줄 곳은 출처 페이지, 요청은 소스 안의 곡, 소리는 영상이나 음원", async () => {
  ytResults = [{ id: "v3", audioUrl: "https://www.youtube.com/watch?v=v3", title: "Song / Artist", artist: "아무 채널", duration: 260 }];
  const up = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/b.mp3", sourceUrl: "https://anilist.co/anime/1", platform: "anisongdb", sourceKey: "amq:3" }, LIMITS);
  assert.deepEqual([up.pageUrl, up.requestKey, up.audioUrl], ["https://anilist.co/anime/1", "amq:3", "https://www.youtube.com/watch?v=v3"], "작품 페이지는 보여 주기만 한다");

  ytResults = [];
  const down = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/c.mp3", sourceUrl: "https://anilist.co/anime/1", platform: "anisongdb", sourceKey: "amq:4" }, LIMITS);
  assert.deepEqual([down.pageUrl, down.requestKey, down.audioUrl], ["https://anilist.co/anime/1", "amq:4", "https://nawdist.animemusicquiz.com/c.mp3"]);

  const bare = await resolved({ title: "주제가", audioUrl: "https://a.animethemes.moe/X-OP2.ogg", sourceKey: "at:10", platform: "animethemes" }, LIMITS);
  assert.equal(bare.pageUrl, "https://a.animethemes.moe/X-OP2.ogg", "출처 페이지가 없으면 음원 주소를 보여 준다. 비우지 않는다");
});

test("요청 키: 곡 페이지는 다듬어서, 영상 후보는 그 영상, 곡 id 는 그대로, 이름뿐이면 소스 이름을 붙여", () => {
  const cases: Array<[Partial<Candidate>, string]> = [
    [{ sourceKey: "https://open.spotify.com/track/abc?si=x", sourceUrl: "https://open.spotify.com/track/abc", platform: "spotify" }, "https://open.spotify.com/track/abc"],
    [{ sourceKey: "https://www.last.fm/music/A/_/B", sourceUrl: "https://www.last.fm/music/A/_/B", platform: "lastfm" }, "https://www.last.fm/music/A/_/B"],
    [{ sourceKey: "yt:abcdefghijk", youtubeUrl: "https://youtu.be/abcdefghijk?si=1" }, "https://www.youtube.com/watch?v=abcdefghijk"],
    [{ sourceKey: "https://www.youtube.com/watch?v=abcdefghijk&list=PL1", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk&list=PL1" }, "https://www.youtube.com/watch?v=abcdefghijk"],
    [{ sourceKey: "amq:48944", platform: "anisongdb", sourceUrl: "https://anilist.co/anime/1" }, "amq:48944"],
    [{ sourceKey: "vocadb:757470", platform: "vocadb", sourceUrl: "https://vocadb.net/S/757470" }, "vocadb:757470"],
    [{ sourceKey: "Re:Zero|Styx Helix", platform: "lastfm" }, "lastfm:Re:Zero|Styx Helix"],
    [{ artist: "가수", title: "곡", platform: "lbradio" }, "lbradio:가수|곡"],
  ];
  for (const [cand, want] of cases) assert.equal(route.requestKeyOf(cand), want, JSON.stringify(cand));
});

// ── 링크 데이터부터 본다 ────────────────────────────────────────────────────

test("링크 데이터에 이 요청의 영상이 있으면 검색하지 않고 그 영상을 쓴다", async () => {
  ledger.set("amq:500", { audioUrl: "https://www.youtube.com/watch?v=ledgervideo", durationSec: 262 });
  ytResults = [{ id: "other", audioUrl: "https://www.youtube.com/watch?v=otherother1", title: "Song / Artist", artist: "채널", duration: 260 }];

  const track = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/x.mp3", sourceUrl: "https://anilist.co/anime/5", platform: "anisongdb", sourceKey: "amq:500" }, LIMITS);

  assert.equal(ytCalls.length, 0, "검색을 아낀다");
  assert.equal(track.audioUrl, "https://www.youtube.com/watch?v=ledgervideo");
  assert.equal(track.requestKey, "amq:500");
  assert.equal(track.pageUrl, "https://anilist.co/anime/5");
  assert.equal(track.audioFoundBy, "ledger", "그 영상이 내려갔으면 다시 찾는다");
  assert.equal(track.duration, 262, "다운로드해 둔 파일의 길이. 이 소스는 길이를 안 준다");
});

test("링크 데이터의 영상이 못 트는 것으로 표시돼 있으면 평소대로 찾는다", async () => {
  route._dead.clear();
  ledger.set("lastfm:A|Song", { audioUrl: "https://www.youtube.com/watch?v=deadvideo01" });
  route.markDead("https://www.youtube.com/watch?v=deadvideo01");
  ytResults = [{ id: "v9", audioUrl: "https://www.youtube.com/watch?v=v9", title: "A - Song", artist: "A", duration: 240 }];

  const track = await resolved({ artist: "A", title: "Song", durationSec: 240, platform: "lastfm", sourceKey: "A|Song" }, LIMITS);

  assert.ok(ytCalls.length > 0);
  assert.equal(track.audioUrl, "https://www.youtube.com/watch?v=v9");
  route._dead.clear();
});

test("링크 데이터가 음원 파일을 가리키면(전에 음원으로 떨어진 곡) 검색하지 않고 소스의 음원을 튼다", async () => {
  ledger.set("amq:501", { audioUrl: "https://nawdist.animemusicquiz.com/old.mp3" });

  const track = await resolved({ artist: "Artist", title: "Song", audioUrl: "https://nawdist.animemusicquiz.com/new.mp3", platform: "anisongdb", sourceKey: "amq:501" }, LIMITS);

  assert.equal(ytCalls.length, 0);
  assert.equal(track.audioUrl, "https://nawdist.animemusicquiz.com/new.mp3", "파일 이름은 바뀔 수 있어 소스가 지금 준 것을 쓴다");
});

// ── 썸네일 ────────────────────────────────────────────────────────────────

// 회귀 대상: 유튜브 검색 결과를 후보 모양으로 옮길 때 thumbnail을 빠뜨렸다. Last.fm·LB Radio는
// 표지를 안 주므로 영상 것이 유일한 그림인데, 그게 없어 디스코드에는 빈 그림이,
// 대시보드에는 파일 아이콘이 떴다.
test("소스가 표지를 안 주면 영상 썸네일을 쓴다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Song", artist: "Ch", duration: 240, thumbnail: "https://i.ytimg.com/vi/v1/hq.jpg" }];

  const track = await resolved({ artist: "Artist", title: "Song", durationSec: 240, sourceKey: "lf:1" }, LIMITS);
  assert.equal(track.thumbnail, "https://i.ytimg.com/vi/v1/hq.jpg");
});

test("소스가 표지를 주면 그쪽이 이긴다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Song", artist: "Ch", duration: 240, thumbnail: "https://i.ytimg.com/vi/v1/hq.jpg" }];

  const track = await resolved({ artist: "Artist", title: "Song", durationSec: 240, thumbnail: "https://vocadb.net/cover.jpg", sourceKey: "vd:1" }, LIMITS);
  assert.equal(track.thumbnail, "https://vocadb.net/cover.jpg");
});

test("어느 소스에서 왔는지 남긴다 — 이상할 때 이것부터 본다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Song", artist: "Ch", duration: 240 }];
  const track = await picked({ minDurationSec: 60, maxDurationSec: 3600, blockedKeywords: [], sources: [{ type: "keyword", keywords: ["아무거나"] }] }, []);
  assert.equal(track.pickedFrom, "keyword");
});

// 차단어는 키워드 출처(유튜브 검색 결과)에만 건다. 다른 출처는 곡 이름이 확실해 오탐만 낸다(B-113). 키워드 출처 필드에 입력하면 전역 대신 그것
test("차단어: 키워드 출처에만, 출처 필드가 있으면 전역 대신 그것", async () => {
  // 출처마다 영상 주소가 있는 후보 하나. 키워드만 검색 결과다(fromSearch)
  const one = (source: GenreSource, title: string) => [{ title, durationSec: 240, youtubeUrl: `https://www.youtube.com/watch?v=${source.type.slice(0, 3)}${title.length}`, fromSearch: source.type === "keyword", sourceKey: `${source.type}:${title}` }];
  let title = "";
  const only: route.Deps = { ...deps, fetch: async (source) => one(source, title) };
  const cfg = (source: GenreSource) => ({ minDurationSec: 60, maxDurationSec: 3600, blockedKeywords: ["mix"], sources: [source] });

  title = "Song mix";
  assert.equal(await route.pickTrack(cfg({ type: "keyword", keywords: ["a"] }), [], only), null, "키워드 출처는 전역 차단어에 걸린다");
  pool._reset();
  assert.ok(await route.pickTrack(cfg({ type: "youtube", url: "https://www.youtube.com/playlist?list=PL1" }), [], only), "재생목록 출처는 걸지 않는다");
  pool._reset();
  assert.ok(await route.pickTrack(cfg({ type: "keyword", keywords: ["a"], blockedKeywords: ["live"] }), [], only), "출처 필드가 있으면 전역(mix)은 안 본다");
  pool._reset();
  title = "Song live";
  assert.equal(await route.pickTrack(cfg({ type: "keyword", keywords: ["a"], blockedKeywords: ["live"] }), [], only), null, "출처 필드의 말에 걸린다");
});

// AI 보조가 한 번 실패하면 같은 고르기의 나머지 판정은 다시 부르지 않는다. 그러려면 고르기 하나가 같은 것을 넘겨야 한다
test("고르기 하나의 판정은 모두 같은 고르기 표시를 받고, 고르기마다 새것이다", async () => {
  ytResults = ["v1", "v2", "v3"].map((id) => ({ id, audioUrl: `https://www.youtube.com/watch?v=${id}`, title: `Song ${id}`, artist: "Ch", duration: 240 }));
  const seen: unknown[] = [];
  const before: unknown[] = []; // 부를 때의 실패 표시
  const failing: route.Deps = {
    ...deps,
    assist: {
      filter: async (candidates) => candidates,
      accepts: async (_track, about) => {
        seen.push(about.pick);
        before.push(about.pick?.failed);
        if (about.pick) about.pick.failed = true;
        return false; // 거절해 다음 후보로 가게
      },
    },
  };
  const cfg = { minDurationSec: 60, maxDurationSec: 3600, blockedKeywords: [], sources: [{ type: "keyword" as const, keywords: ["아무거나"] }] };
  assert.equal(await route.pickTrack(cfg, [], failing), null);
  assert.equal(seen.length, 3, "후보 세 개를 판정했다");
  assert.ok(seen[0] && seen.every((one) => one === seen[0]), "같은 표시");
  assert.deepEqual(before, [false, true, true], "첫 실패 뒤의 판정은 실패를 안다");

  pool._reset();
  const first = seen[0];
  seen.length = 0;
  before.length = 0;
  await route.pickTrack(cfg, [], failing);
  assert.notEqual(seen[0], first, "고르기마다 새것");
  assert.deepEqual(before, [false, true, true]);
});

// MusicBrainz는 모르는 아티스트·곡을 정해진 이름으로 채운다([no artist]·[unknown] 등).
// 그대로 두면 그걸 유튜브에 검색하게 된다.
//
// 회귀 대상: 처음엔 "대괄호로 싸인 것"을 전부 필터링했는데, `[Alexandros]`가 실존하는 밴드다.
test("MusicBrainz 자리표시 항목은 후보에서 뺀다", () => {
  const { _placeholder } = sources;

  for (const bad of ["[no artist]", "[unknown]", "  [data]  ", "[TRADITIONAL]"]) assert.equal(_placeholder.test(bad), true, bad);
  for (const ok of ["YOASOBI", "Oasis", "[Alexandros]", "Song [Live]", ""]) assert.equal(_placeholder.test(ok), false, ok);
});

// ── 내려간 영상 ───────────────────────────────────────────────────────────

// 소스 DB는 그 영상이 아직 살아 있다고 믿는다. 우리가 기억하지 않으면 같은 것을 또 고르고,
// 그때마다 재생이 실패한다.
test("못 트는 영상으로 표시하면 다시 고르지 않는다", async () => {
  route._dead.clear();
  const url = "https://www.youtube.com/watch?v=BYlcTa9SQXs";

  const before = await resolve({ title: "노래", durationSec: 200, youtubeUrl: url, sourceKey: "yt:BYlcTa9SQXs" }, LIMITS);
  assert.ok(before, "표시하기 전에는 멀쩡히 고른다");

  route.markDead(url);
  assert.equal(route.rejector([])({ title: "노래", youtubeUrl: url }), true, "후보 단계에서 빠져야 한다");

  // 이름으로 찾아온 것도 같은 영상이면 버린다
  ytResults = [{ id: "BYlcTa9SQXs", url, title: "Song", artist: "A", duration: 240 }];
  assert.equal(await resolve({ artist: "A", title: "Song", durationSec: 240, sourceKey: "lf:1" }, LIMITS), null);

  route._dead.clear();
});

test("트랙을 통째로 넘겨도 표시된다 — 출처 곡은 페이지가 영상이 아니라 음원 주소를 본다", () => {
  route._dead.clear();
  route.markDead({ pageUrl: "https://vocadb.net/S/1", audioUrl: "https://youtu.be/abcdefghijk" });
  assert.equal(route._dead.has("abcdefghijk"), true);
  route._dead.clear();
});

// 회귀 대상: VocaDB 계열은 영상이 내려간 것을 disabled 로 표시해 둔다(웹에서 "PV 사용할 수
// 없음"으로 회색이 되는 그것). 그걸 안 보고 Original 부터 찾아서, Bad Apple!! 처럼 죽은 Original
// 다음에 멀쩡한 Original 이 있는 곡에서 정확히 틀린 것을 집었다.
test("VocaDB 계열은 disabled 된 PV를 고르지 않는다", () => {
  const pick = (pvs: Array<{ service: string; disabled?: boolean; pvType?: string; url: string }>) => {
    const ok = pvs.filter((p) => p.service === "Youtube" && !p.disabled);
    return (ok.find((p) => p.pvType === "Original") || ok[0])?.url;
  };

  // 실제 Bad Apple!!(touhoudb.com/S/1041)의 PV 순서
  const badApple = [
    { service: "NicoNicoDouga", pvType: "Other", disabled: false, url: "nico" },
    { service: "Youtube", pvType: "Original", disabled: true, url: "죽은것" },
    { service: "Youtube", pvType: "Original", disabled: false, url: "살아있는것" },
    { service: "Youtube", pvType: "Other", disabled: false, url: "다른사람업로드" },
  ];
  assert.equal(pick(badApple), "살아있는것");

  // Original 이 다 죽었으면 살아 있는 다른 유튜브 PV로 내려간다
  assert.equal(pick([{ service: "Youtube", pvType: "Original", disabled: true, url: "죽은것" }, badApple[3]]), "다른사람업로드");
  // 유튜브가 하나도 안 살아 있으면 고르지 않는다 — 니코동은 우리가 못 튼다
  assert.equal(pick([badApple[0], badApple[1]]), undefined);
});

// ── 소스 기본값 ───────────────────────────────────────────────────────────

// 기본값은 조용히 성격을 정한다. 뒤집히면 아무도 모른 채 딴 곡이 나오므로 여기 못 박는다.
test("소스 기본값 — 입력하지 않았을 때 무엇으로 도는가", () => {
  const { SPEC } = sources;

  // lbradio: 이름과 반대로 hard 가 더 알려진 곡을 준다. 자동재생은 아는 곡이 나오는 편이 낫다.
  assert.ok(SPEC.lbradio.enums?.mode.includes("hard"));

  // 사이트마다 "본체"가 다르다 — utaitedb 는 커버, touhoudb 는 어레인지가 본체다
  for (const key of ["songTypes", "sort"]) assert.ok(Array.isArray(SPEC.vocadb.enums?.[key]));
  assert.ok(SPEC.touhoudb.enums?.songTypes.includes("Arrangement"));
  assert.ok(SPEC.animethemes.enums?.mediaFormat.includes("TV Short"), "띄어쓰기까지 그대로여야 한다");
});

// `languages` 파라미터는 저쪽이 조용히 무시한다 — 쓰레기 값을 넣어도 전체가 온다.
// 실제로 듣는 것은 advancedFilters 쪽이고, 한 번에 하나만 걸린다.
test("가사 언어는 advancedFilters 로 건다 — 한 번에 하나씩", () => {
  const { _advancedFilters, _someLanguages, SPEC } = sources;

  assert.deepEqual(_advancedFilters(null), {}, "안 고르면 조건을 안 붙인다");

  const one = _advancedFilters("ko");
  assert.equal(one["advancedFilters[0][filterType]"], "Lyrics");
  assert.equal(one["advancedFilters[0][param]"], "ko");
  assert.ok(!("languages" in one), "languages 로는 안 건다");

  // 둘을 한꺼번에 걸면 "둘 다 있는 곡"이 되어 ja+ko 가 2,054곡에서 347곡으로 준다.
  // 그래서 언어마다 따로 받아 섞는다.
  assert.deepEqual(_someLanguages(["ko", "en"]), ["ko", "en"]);
  assert.deepEqual(_someLanguages([]), [null], "안 골랐으면 조건 없이 한 번");

  // 언어 하나에 요청이 두 번이다. 많이 선택했으면 그때그때 몇 개만 — 판마다 달라 결국 고르게 섞인다.
  const many = ["ja", "en", "ko", "zh", "es", "fr", "de"];
  const some = _someLanguages(many);
  assert.equal(some.length, 5);
  assert.equal(new Set(some).size, 5, "같은 언어를 두 번 돌지 않는다");
  assert.ok(some.every((one) => one !== null && many.includes(one)));

  // 사이트마다 있는 언어가 다르다 — 없는 것을 선택하면 0곡이 온다
  assert.ok(SPEC.vocadb.enums?.languages.includes("ko"));
  assert.ok(!SPEC.touhoudb.enums?.languages.includes("ms"), "동방에는 말레이어 곡이 없다");
});

// ── 중복 회피 ─────────────────────────────────────────────────────────────

test("최근에 튼 곡은 이름으로도 필터링한다 — 소스가 다르면 주소가 다르기 때문이다", () => {
  const reject = route.rejector([{ artist: "YOASOBI", title: "Idol", audioUrl: "https://www.youtube.com/watch?v=a" }]);
  assert.equal(reject({ artist: "yoasobi", title: "  IDOL " }), true, "대소문자·공백은 같은 곡으로 본다");
  assert.equal(reject({ artist: "YOASOBI", title: "Racing Into The Night" }), false);
});

test("음원 주소가 같아도 필터링한다 — 모양이 달라도 다듬어 비교한다", () => {
  const reject = route.rejector([{ title: "x", audioUrl: "https://www.youtube.com/watch?v=samesamesam" }]);
  assert.equal(reject({ title: "다른 제목", youtubeUrl: "https://youtu.be/samesamesam?si=1" }), true);
  assert.equal(reject({ title: "또 다른 제목", youtubeUrl: "https://youtu.be/otherotherx" }), false);
});

// 회귀 대상: 출처 곡은 url 에 출처 페이지를 들고 있어 후보의 영상 주소와 비교하면 한 번도 맞지 않았다(이름 비교가 막아 주고 있었다)
test("출처 곡을 최근에 틀었으면 같은 영상을 다른 이름으로 가져와도 필터링한다", () => {
  const reject = route.rejector([{ title: "Fatal", pageUrl: "https://anilist.co/anime/150672", audioUrl: "https://www.youtube.com/watch?v=fatalfatal1" }]);
  assert.equal(reject({ title: "ファタール", youtubeUrl: "https://www.youtube.com/watch?v=fatalfatal1" }), true);
});

// 소스마다 띄어쓰기·하이픈·장식 기호를 다르게 적는다. 실측한 실제 쌍들이다.
test("표기가 다른 같은 곡을 같다고 본다", () => {
  const same = [
    [
      ["Kakuu Bansanka", "Nan mo nee"],
      ["Kakuu Bansanka", "Nanmonee"],
    ],
    [
      ["x", "Laid-Back Journey"],
      ["x", "Laid Back Journey"],
    ],
    [
      ["x", "Happy☆Material"],
      ["x", "Happy Material"],
    ],
    [
      ["x", "Geki! Teikoku Kageki-dan"],
      ["x", "Geki! Teikoku Kagekidan"],
    ],
    [
      ["x", "Long Hope Philia (TV Limited)"],
      ["x", "Long Hope Philia <TV Limited.>"],
    ],
  ];
  for (const [[a1, t1], [a2, t2]] of same) {
    const reject = route.rejector([{ artist: a1, title: t1 }]);
    assert.equal(reject({ artist: a2, title: t2 }), true, `"${t1}" == "${t2}"`);
  }
});

test("버전·참여 표기가 다르면 다른 곡이다 — 너무 뭉개면 멀쩡한 곡이 사라진다", () => {
  const reject = route.rejector([
    { artist: "a", title: "Uragirimono no Requiem" },
    { artist: "b", title: "NEVER SAY GOODBYE" },
  ]);
  assert.equal(reject({ artist: "a", title: "Uragirimono no Requiem Diavolo Ver." }), false);
  assert.equal(reject({ artist: "b", title: "NEVER SAY GOODBYE feat. Mummy-D" }), false);
});

// 정규화에서 글자를 통째로 버리면 일본어 제목이 전부 빈 문자열이 되어 한 곡으로 뭉개진다.
// 자동재생 소스 절반이 일본어 제목을 준다(Last.fm·LB Radio·VocaDB 계열).
test("일본어 제목끼리 뭉개지지 않는다", () => {
  const reject = route.rejector([{ artist: "高橋洋子", title: "残酷な天使のテーゼ" }]);
  assert.equal(reject({ artist: "LiSA", title: "紅蓮華" }), false, "서로 다른 일본어 곡");
  assert.equal(reject({ artist: "高橋洋子", title: "残酷な天使のテーゼ" }), true, "같은 곡은 여전히 잡는다");
});

// ── 소스 훑기 ─────────────────────────────────────────────────────────────

test("무게대로 훑되 모든 소스를 한 번씩 거친다 — 목록이 곧 폴백 사슬이다", () => {
  const list = [{ type: "a", weight: 5 }, { type: "b", weight: 1 }, { type: "c" }];
  const seen = [...route._byWeight(list)].map((s) => s.type);
  assert.equal(seen.length, 3);
  assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
});

test("쓸 수 있는 소스가 없으면 null — 아무거나 틀지 않는다", async () => {
  assert.equal(await pick({ sources: [] }), null);
  assert.equal(await pick({ sources: [{ type: "없는소스" }] }), null);
});

test("앞 소스가 빈 손이면 다음 소스로 넘어간다", async () => {
  ytResults = [{ id: "v1", audioUrl: "https://www.youtube.com/watch?v=v1", title: "Song", artist: "Artist", duration: 240 }];
  const cfg = {
    minDurationSec: 60,
    maxDurationSec: 3600,
    blockedKeywords: [],
    // 검색어가 없는 keyword 소스는 반드시 빈 손으로 온다. .env에 무엇이 있든 결과가 같아야
    // 하므로 키가 필요한 소스는 쓰지 않는다 — 키가 있으면 진짜 호출이 나간다.
    sources: [
      { type: "keyword", keywords: [], weight: 9 },
      { type: "keyword", keywords: ["아무거나"] },
    ],
  };
  const track = await picked(cfg, []);
  assert.ok(track, "앞이 비어도 뒤 소스로 골라야 한다");
  assert.equal(track.platform, "youtube");
});

test("키가 없는 소스는 아예 후보에서 빠진다", () => {
  // 키가 필요한 소스는 SPEC 에 env(키 이름)가 있고, 그 키가 .env 에 있어야 쓸 수 있다(config/source-keys)
  for (const type of sources.TYPES) {
    const need = sources.needsOf(type);
    if (!need) assert.equal(sources.usable(type), true, `${type}는 키가 필요 없으니 늘 쓸 수 있다`);
    else assert.equal(typeof need.env, "string", `${type}는 무엇이 필요한지 말할 수 있어야 한다`);
  }
  assert.equal(sources.usable("없는소스"), false);
});

test("키가 필요한 소스는 그 키가 있을 때만 쓴다", async () => {
  await withConfig({ sources: { lastfmKey: null, listenbrainzToken: "token" } }, () => {
    assert.equal(sources.usable("lastfm"), false);
    assert.equal(sources.usable("lbradio"), true);
  });
  await withConfig({ sources: { lastfmKey: "key", listenbrainzToken: null } }, () => {
    assert.equal(sources.usable("lastfm"), true);
    assert.equal(sources.usable("lbradio"), false);
  });
});

test("스포티파이 재생목록 소스는 키 없이도 쓴다(재생목록 · 아티스트는 익명 경로)", async () => {
  await withConfig({ spotify: { clientId: null, clientSecret: null } }, () => {
    assert.equal(sources.usable("spotify"), true);
    assert.equal(sources.needsOf("spotify"), null);
  });
});
