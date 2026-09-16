"use strict";

process.env.DISCORD_TOKEN ||= "test-token";
process.env.CLIENT_ID ||= "test-client";

const test = require("node:test");
const assert = require("node:assert/strict");
const TrackResolver = require("../src/TrackResolver");
const YouTube = require("../src/YouTube");
const Spotify = require("../src/Spotify");
const SoundCloud = require("../src/SoundCloud");
const CacheManager = require("../src/CacheManager");

test("accepts supported media hosts by parsed hostname", () => {
  assert.equal(TrackResolver.detectPlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
  assert.equal(TrackResolver.detectPlatform("https://open.spotify.com/track/123abc"), "spotify");
  assert.equal(TrackResolver.detectPlatform("spotify:track:123abc"), "spotify");
  assert.equal(TrackResolver.detectPlatform("https://soundcloud.com/artist/track"), "soundcloud");
});

test("does not treat embedded domain text as a trusted media URL", () => {
  const internalPlaylist = "http://127.0.0.1:33333/youtube.com/playlist?list=PL123";
  assert.equal(YouTube.isYouTubeURL(internalPlaylist), false);
  assert.equal(YouTube.isPlaylist(internalPlaylist), false);
  assert.equal(YouTube.isYouTubeURL("https://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(Spotify.isSpotifyURL("https://evil.example/open.spotify.com/track/123abc"), false);
  assert.equal(SoundCloud.isSoundCloudURL("https://evil.example/soundcloud.com/artist/track"), false);
});

test("recognizes canonical YouTube playlists and video IDs", () => {
  assert.equal(YouTube.isPlaylist("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123"), true);
  assert.equal(YouTube.isPlaylist("https://youtu.be/dQw4w9WgXcQ?list=PL123"), true);
  assert.equal(YouTube.extractVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(YouTube.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

// /live/ID가 빠져 있어 URL 문자열이 그대로 검색어가 됐고, 검색이 돌려준 무관한 영상이 재생됐다
// (2026-09-08 실사용 발견). 형태별로 못박는다.
test("YouTube URL 형태별 인식 — /live/ 포함", () => {
  const shapes = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/v/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/rmn4m0Ieajk", "rmn4m0Ieajk"],
    ["https://m.youtube.com/live/rmn4m0Ieajk", "rmn4m0Ieajk"],
  ];
  for (const [url, id] of shapes) {
    assert.equal(YouTube.isYouTubeURL(url), true, url);
    assert.equal(YouTube.extractVideoId(url), id, url);
  }

  // 같은 영상이면 어느 형태로 넣어도 같은 캐시 키로 접힌다 — /live/도 예외가 아니다
  assert.equal(CacheManager._normalizeSourceUrl("https://www.youtube.com/live/rmn4m0Ieajk"), "https://www.youtube.com/watch?v=rmn4m0Ieajk");
});

test("모르는 형태의 유튜브 링크는 검색으로 흘리지 않고 거절한다", async () => {
  // 클립은 유튜브가 기능을 없앴다(2026). 채널·검색 결과 페이지도 재생 대상이 아니다.
  const unsupported = ["https://www.youtube.com/clip/UgkxDwCneHNsPn-e8AtJkR6rRVpNlHqHOZDE", "https://www.youtube.com/@someChannel", "https://www.youtube.com/results?search_query=test"];

  for (const url of unsupported) {
    assert.equal(YouTube.isYouTubeURL(url), false, url);
    assert.equal(TrackResolver.isUnsupportedYouTubeLink(url), true, url);

    const result = await TrackResolver.getTrackData(url);
    assert.equal(result.success, false, `${url} — 조용히 다른 영상을 틀면 안 된다`);
    assert.match(result.message, /유튜브 주소/);
  }

  // 유튜브가 아닌 검색어는 그대로 검색으로 간다
  assert.equal(TrackResolver.isUnsupportedYouTubeLink("아이유 밤편지"), false);
  assert.equal(TrackResolver.isUnsupportedYouTubeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
});

test("cache normalization only canonicalizes genuine YouTube URLs", () => {
  const disguised = "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ";
  assert.equal(CacheManager._normalizeSourceUrl(disguised), disguised);
  assert.equal(CacheManager._normalizeSourceUrl("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});
