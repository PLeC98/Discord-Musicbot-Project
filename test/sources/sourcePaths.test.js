// 곡 찾기(sources/lookup) · 유튜브 동등물(youtube/equivalent) · 스트림(streamUrl)의 갈래를 고정한다
// (링크 종류별 조회 · 캐시 지름길 · 열쇠 만들기 · 동등물 찾기 · 재검색 · 스트림).
//
// 부르는 쪽(YouTube · Spotify · SoundCloud · DirectLink)은 메서드만 바꿔 끼우고, 장부는 진짜 저장소를 임시 DB 로 쓴다.
// 유튜브 검색 결과도 트랙 모양이다(음원 주소가 audioUrl).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-paths-"));
const audioCache = (await import("../../src/store/audioCache.js")).default;
const trackLookup = (await import("../../src/store/trackLookup.js")).default;
audioCache._cacheDir = path.join(TMP, "audio_cache");
audioCache.initialize(path.join(TMP, "cache.db"));

const YouTube = (await import("../../src/sources/youtube/index.js")).default;
const Spotify = (await import("../../src/sources/spotify.js")).default;
const SoundCloud = (await import("../../src/sources/soundcloud.js")).default;
const DirectLink = (await import("../../src/sources/direct.js")).default;
const equivalent = (await import("../../src/sources/youtube/equivalent.js")).default;
const lookup = (await import("../../src/sources/lookup.js")).default;
const streamUrl = (await import("../../src/sources/streamUrl.js")).default;
const { audioKeyOf } = (await import("../../src/rules/audioKeyOf.ts")).default;

// 바꿔 끼운 메서드를 시험 끝에 되돌린다
const swaps = [];
function swap(obj, key, fn) {
  swaps.push([obj, key, obj[key]]);
  obj[key] = fn;
}

beforeEach(() => {
  while (swaps.length) {
    const [obj, key, fn] = swaps.pop();
    obj[key] = fn;
  }
  audioCache.db.exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
  fs.rmSync(audioCache._cacheDir, { recursive: true, force: true, maxRetries: 5 });
});

after(() => {
  while (swaps.length) {
    const [obj, key, fn] = swaps.pop();
    obj[key] = fn;
  }
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

const ytTrack = (id, extra = {}) => ({ id, title: `곡 ${id}`, artist: "가수", url: `https://www.youtube.com/watch?v=${id}`, duration: 200, platform: "youtube", ...extra });

// ── 링크 종류 ─────────────────────────────────────────────────────────

test("링크 종류: 유튜브 · 스포티파이 · 사운드클라우드 · 직접 링크, 검색어는 유튜브(검색), 모르는 링크는 unknown", () => {
  const cases = [
    ["https://youtu.be/aaaaaaaaaaa", "youtube"],
    ["https://open.spotify.com/track/abc", "spotify"],
    ["spotify:album:abc", "spotify"],
    ["https://soundcloud.com/a/b", "soundcloud"],
    ["https://files.test/a.mp3", "direct"],
    ["https://anilist.co/anime/1", "unknown"],
    ["그냥 검색어", "youtube"],
  ];
  for (const [q, want] of cases) assert.equal(lookup.detectPlatform(q), want, q);
  assert.equal(lookup.isUnsupportedLink("https://www.youtube.com/@channel"), true);
  assert.equal(lookup.isUnsupportedLink("https://www.youtube.com/watch?v=aaaaaaaaaaa"), false);
});

// ── 조회 ──────────────────────────────────────────────────────────────

test("조회: 유튜브 재생목록은 구간을 넘겨 받고, 못 받으면 같은 주소로 검색한다", async () => {
  const seen = [];
  swap(YouTube, "getPlaylist", async (url, range) => {
    seen.push(range);
    return { tracks: [ytTrack("p1")], total: 40, nextOffset: 10 };
  });
  const r = await lookup.getTrackData("https://www.youtube.com/playlist?list=PL1", "t", { offset: 0, limit: 10 });
  assert.deepEqual(seen, [{ offset: 0, limit: 10 }]);
  assert.deepEqual({ success: r.success, isPlaylist: r.isPlaylist, collection: r.collection, total: r.total, nextOffset: r.nextOffset }, { success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10 });

  swap(YouTube, "getPlaylist", async () => null);
  swap(YouTube, "search", async (q, n) => [ytTrack("s1", { q, n })]);
  const fallback = await lookup.getTrackData("https://www.youtube.com/playlist?list=PL2");
  assert.equal(fallback.isPlaylist, false);
  assert.deepEqual([fallback.tracks[0].q, fallback.tracks[0].n], ["https://www.youtube.com/playlist?list=PL2", 1]);
});

test("조회: 모르는 모양의 유튜브 링크는 검색으로 흘리지 않고 거절한다", async () => {
  swap(YouTube, "search", async () => assert.fail("검색하면 안 된다"));
  assert.deepEqual(await lookup.getTrackData("https://www.youtube.com/@channel"), { success: false, message: "❌ 재생할 수 없는 유튜브 주소입니다." });
});

test("조회: 스포티파이 앨범 · 가수 · 재생목록은 모음으로, 곡은 한 곡으로, 글자는 스포티파이 검색으로", async () => {
  swap(Spotify, "getCollection", async (url) => ({ tracks: [{ title: url }], total: 12, nextOffset: 1 }));
  const album = await lookup.getTrackData("https://open.spotify.com/album/al1");
  assert.deepEqual([album.isPlaylist, album.collection, album.total], [true, "album", 12]);
  const one = await lookup.getTrackData("https://open.spotify.com/track/tr1");
  assert.deepEqual([one.isPlaylist, one.collection, one.total, one.nextOffset], [false, null, null, null]);
});

test("조회: 사운드클라우드 · 직접 링크는 한 곡", async () => {
  swap(SoundCloud, "search", async (q, n) => [{ title: "sc", q, n }]);
  swap(DirectLink, "getInfo", async (url) => [{ title: "file", url }]);
  const sc = await lookup.getTrackData("https://soundcloud.com/a/b");
  assert.deepEqual([sc.tracks[0].q, sc.tracks[0].n], ["https://soundcloud.com/a/b", 1]);
  const direct = await lookup.getTrackData("https://files.test/a.mp3");
  assert.equal(direct.tracks[0].url, "https://files.test/a.mp3");
});

test("조회: 결과가 없으면 no-result, 던지면 lookup-failed 와 그 오류. 문장은 부르는 쪽이 만든다", async () => {
  swap(YouTube, "search", async () => []);
  assert.deepEqual(await lookup.getTrackData("없는 곡"), { success: false, code: "no-result" });
  const boom = new Error("ECONNRESET");
  swap(YouTube, "search", async () => {
    throw boom;
  });
  assert.deepEqual(await lookup.getTrackData("끊긴 곡"), { success: false, code: "lookup-failed", error: boom });
});

test("조회 실패의 안내문: 결과 없음 · 조회가 던진 오류", () => {
  const ErrorHandler = require("../../src/ui/errorMessages");
  assert.equal(ErrorHandler.lookupFailure({ code: "no-result" }), "❌ 결과를 찾을 수 없습니다!");
  assert.match(ErrorHandler.lookupFailure({ code: "lookup-failed", error: new Error("ECONNRESET") }), /네트워크 오류/);
});

test("모음 이어 받기: 유튜브 재생목록 · 스포티파이만. 못 받으면 빈 구간(검색으로 안 넘어간다)", async () => {
  swap(YouTube, "getPlaylist", async () => null);
  assert.deepEqual(await lookup.getCollection("https://www.youtube.com/playlist?list=PL", { offset: 50, limit: 10 }), { tracks: [], total: null, nextOffset: null });
  swap(YouTube, "getPlaylist", async () => ({ tracks: [1], total: 60 }));
  assert.deepEqual(await lookup.getCollection("https://www.youtube.com/playlist?list=PL"), { tracks: [1], total: 60, nextOffset: null });
  swap(Spotify, "getCollection", async (url, range) => ({ url, range }));
  assert.deepEqual(await lookup.getCollection("https://open.spotify.com/playlist/p", { offset: 5 }), { url: "https://open.spotify.com/playlist/p", range: { offset: 5 } });
  assert.deepEqual(await lookup.getCollection("https://soundcloud.com/a/sets/b"), { tracks: [], total: null, nextOffset: null });
});

test("캐시 지름길: 받아 둔 곡은 조회 없이 장부의 트랙으로. 재생목록 · 모르는 유튜브 링크는 지름길을 안 탄다", async () => {
  const url = "https://www.youtube.com/watch?v=ccccccccccc";
  const file = audioCache.getFilePath("yt:ccccccccccc");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  audioCache.recordDownloadStart("yt:ccccccccccc", { title: "t" });
  audioCache.recordDownloadComplete("yt:ccccccccccc", file, 1, { title: "t" }, { durationSec: 99 });
  trackLookup.recordTrackLookup({ requestKey: url, pageUrl: url, audioUrl: "https://www.youtube.com/watch?v=ccccccccccc", platform: "youtube", title: "장부 제목", artist: "장부 가수" });
  swap(YouTube, "search", async () => assert.fail("조회하면 안 된다"));

  const hit = await lookup.resolveQuery(`https://youtu.be/ccccccccccc?si=share`);
  assert.deepEqual([hit.success, hit.isPlaylist, hit.tracks[0].title, hit.tracks[0].duration, hit.tracks[0].audioUrl], [true, false, "장부 제목", 99, url]);

  let playlistAsked = false;
  swap(YouTube, "getPlaylist", async () => {
    playlistAsked = true;
    return null;
  });
  swap(YouTube, "search", async () => []);
  await lookup.resolveQuery(`${url}&list=PLx`);
  assert.equal(playlistAsked, true, "list= 가 있으면 캐시의 한 곡이 재생목록을 가리지 않게 지름길을 건너뛴다");
});

// ── 동등물 찾기 · 재검색 ──────────────────────────────────────────────

test("동등물: 장부에 매핑이 있으면 검색하지 않고 쓰며, 장부에서 왔다고 표시한다", async () => {
  audioCache.recordDownloadStart("yt:fffffffffff", { title: "t" });
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/sp1", pageUrl: "https://open.spotify.com/track/sp1", audioUrl: "https://www.youtube.com/watch?v=fffffffffff", platform: "spotify", title: "곡", artist: "가수" });
  swap(YouTube, "search", async () => assert.fail("검색하면 안 된다"));
  const track = { title: "곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp1", requestKey: "https://open.spotify.com/track/sp1", platform: "spotify", duration: 200 };

  const url = await equivalent.findYouTubeEquivalent(track);

  assert.equal(url, "https://www.youtube.com/watch?v=fffffffffff");
  assert.equal(audioKeyOf(track.audioUrl), "yt:fffffffffff");
  assert.equal(track.audioFoundBy, "ledger");
});

test("동등물: 검색 결과에서 라이브를 빼고 점수로 고른다", async () => {
  const queries = [];
  swap(YouTube, "search", async (q, n) => {
    queries.push([q, n]);
    return [
      { id: "livelivelil", audioUrl: "https://www.youtube.com/watch?v=livelivelil", title: "곡 라이브 방송", artist: "가수", duration: 0, isLive: true },
      { id: "goodgoodgoo", audioUrl: "https://www.youtube.com/watch?v=goodgoodgoo", title: "가수 - 곡", artist: "가수", duration: 200 },
    ];
  });
  const track = { title: "곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp2", requestKey: "https://open.spotify.com/track/sp2", platform: "spotify", duration: 200 };

  const url = await equivalent.findYouTubeEquivalent(track);

  assert.ok(queries.length >= 1);
  assert.ok(
    queries.every(([, n]) => n === 6),
    "검색마다 6개씩",
  );
  assert.equal(url, "https://www.youtube.com/watch?v=goodgoodgoo");
  assert.equal(track.audioUrl, "https://www.youtube.com/watch?v=goodgoodgoo");
  assert.equal(track.audioFoundBy, "search", "새로 찾은 것은 내려가도 다시 찾지 않는다");
});

test("동등물: 이미 음원 주소가 있으면 그대로 돌려주고, 후보가 없으면 null", async () => {
  const has = { platform: "lastfm", audioUrl: "https://www.youtube.com/watch?v=hhhhhhhhhhh" };
  assert.equal(await equivalent.findYouTubeEquivalent(has), has.audioUrl);

  swap(YouTube, "search", async () => []);
  assert.equal(await equivalent.findYouTubeEquivalent({ title: "없음", artist: "?", pageUrl: "https://open.spotify.com/track/none", requestKey: "https://open.spotify.com/track/none", platform: "spotify" }), null);
});

test("재검색: 장부의 매핑을 지우고 칸을 비운 뒤 새로 찾는다", async () => {
  audioCache.recordDownloadStart("yt:deaddeaddea", { title: "t" });
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/sp3", pageUrl: "https://open.spotify.com/track/sp3", audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", platform: "spotify", title: "곡", artist: "가수" });
  swap(YouTube, "search", async () => [{ id: "newnewnewne", audioUrl: "https://www.youtube.com/watch?v=newnewnewne", title: "곡", artist: "가수", duration: 200 }]);
  const track = { title: "곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp3", requestKey: "https://open.spotify.com/track/sp3", platform: "spotify", duration: 200, audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", audioFoundBy: "ledger" };

  const url = await equivalent.reresolveYouTube(track);

  assert.equal(url, "https://www.youtube.com/watch?v=newnewnewne");
  assert.equal(track.audioFoundBy, "search");
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/sp3"), null, "장부 매핑을 지운다(새 매핑은 받을 때 적힌다)");
});

// ── 스트림 ────────────────────────────────────────────────────────────

test("스트림: 장부에서 온 영상이 내려갔으면 한 번 다시 찾아 그것으로 연다", async () => {
  const asked = [];
  swap(YouTube, "getStream", async (url) => {
    asked.push(url);
    if (url.includes("deaddeaddea")) throw new Error("ERROR: Video unavailable");
    return { url: "https://rr.googlevideo.com/new" };
  });
  swap(equivalent, "reresolveYouTube", async (t) => {
    t.audioUrl = "https://www.youtube.com/watch?v=newnewnewne";
    return t.audioUrl;
  });
  const track = { title: "곡", platform: "spotify", pageUrl: "https://open.spotify.com/track/sp4", requestKey: "https://open.spotify.com/track/sp4", audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", audioFoundBy: "ledger" };

  const s = await streamUrl.getStream(track, 5);

  assert.deepEqual(asked, ["https://www.youtube.com/watch?v=deaddeaddea", "https://www.youtube.com/watch?v=newnewnewne"]);
  assert.equal(s.url, "https://rr.googlevideo.com/new");
});

test("스트림: 새로 찾은 영상이 내려간 것은 다시 찾지 않는다. 사운드클라우드는 제 주소로", async () => {
  swap(YouTube, "getStream", async () => {
    throw new Error("ERROR: Video unavailable");
  });
  swap(equivalent, "reresolveYouTube", async () => assert.fail("다시 찾으면 안 된다"));
  await assert.rejects(streamUrl.getStream({ platform: "spotify", audioUrl: "https://www.youtube.com/watch?v=x", audioFoundBy: "search" }), /Video unavailable/);

  swap(SoundCloud, "getStream", async (url) => ({ url: `${url}#stream` }));
  assert.deepEqual(await streamUrl.getStream({ platform: "soundcloud", audioUrl: "https://soundcloud.com/a/b" }), { url: "https://soundcloud.com/a/b#stream" });
});
