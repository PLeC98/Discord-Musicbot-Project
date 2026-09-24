// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
process.env.DISCORD_TOKEN ||= "test-token";
process.env.CLIENT_ID ||= "test-client";

import test from "node:test";
const links = await import("../../src/rules/links.ts");
import assert from "node:assert/strict";
const lookup = await import("../../src/sources/lookup.ts");
const { canonicalUrl } = await import("../../src/rules/canonicalUrl.ts");

test("accepts supported media hosts by parsed hostname", () => {
  assert.equal(lookup.detectPlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
  assert.equal(lookup.detectPlatform("https://open.spotify.com/track/123abc"), "spotify");
  assert.equal(lookup.detectPlatform("spotify:track:123abc"), "spotify");
  assert.equal(lookup.detectPlatform("https://soundcloud.com/artist/track"), "soundcloud");
});

test("does not treat embedded domain text as a trusted media URL", () => {
  const internalPlaylist = "http://127.0.0.1:33333/youtube.com/playlist?list=PL123";
  assert.equal(links.isYouTubeURL(internalPlaylist), false);
  assert.equal(links.isYouTubePlaylist(internalPlaylist), false);
  assert.equal(links.isYouTubeURL("https://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(links.isSpotifyURL("https://evil.example/open.spotify.com/track/123abc"), false);
  assert.equal(links.isSoundCloudURL("https://evil.example/soundcloud.com/artist/track"), false);
});

test("recognizes canonical YouTube playlists and video IDs", () => {
  assert.equal(links.isYouTubePlaylist("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123"), true);
  assert.equal(links.isYouTubePlaylist("https://youtu.be/dQw4w9WgXcQ?list=PL123"), true);
  assert.equal(links.extractVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(links.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
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
    assert.equal(links.isYouTubeURL(url), true, url);
    assert.equal(links.extractVideoId(url), id, url);
  }

  // 같은 영상이면 어느 형태로 넣어도 같은 캐시 키로 접힌다 — /live/도 예외가 아니다
  assert.equal(canonicalUrl("https://www.youtube.com/live/rmn4m0Ieajk"), "https://www.youtube.com/watch?v=rmn4m0Ieajk");
});

test("모르는 형태의 유튜브 링크는 검색으로 흘리지 않고 거절한다", async () => {
  // 클립은 유튜브가 기능을 없앴다(2026). 채널·검색 결과 페이지도 재생 대상이 아니다.
  const unsupported = ["https://www.youtube.com/clip/UgkxDwCneHNsPn-e8AtJkR6rRVpNlHqHOZDE", "https://www.youtube.com/@someChannel", "https://www.youtube.com/results?search_query=test"];

  for (const url of unsupported) {
    assert.equal(links.isYouTubeURL(url), false, url);
    assert.equal(lookup.isUnsupportedLink(url), true, url);

    const result = await lookup.getTrackData(url);
    assert.equal(result.success, false, `${url} — 조용히 다른 영상을 틀면 안 된다`);
    assert.match(result.message, /유튜브 주소/);
  }

  // 검색어는 그대로 검색으로 간다
  assert.equal(lookup.isUnsupportedLink("아이유 밤편지"), false);
  assert.equal(lookup.isUnsupportedLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
});

test("cache normalization only canonicalizes genuine YouTube URLs", () => {
  const disguised = "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ";
  assert.equal(canonicalUrl(disguised), disguised);
  assert.equal(canonicalUrl("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

// 유튜브가 아닌 사이트도 같다. 주소 글자를 검색어로 쓰면 엉뚱한 곡이 나오고, 장부가 맞으면 엉뚱한 캐시 곡이 나온다
test("모르는 사이트의 링크도 거절하고, 캐시 장부를 보지 않는다", async () => {
  for (const url of ["https://anilist.co/anime/21827", "https://chzzk.naver.com/live/abc", "http://example.com/page"]) {
    assert.equal(lookup.isUnsupportedLink(url), true, url);
    const result = await lookup.resolveQuery(url, "test");
    assert.equal(result.success, false, url);
    assert.equal(result.message, "❌ 지원하지 않는 링크입니다.", url);
  }
  assert.equal(lookup.isUnsupportedLink("spotify:track:abc"), false, "스포티파이 URI 는 링크 모양이 달라도 다룬다");
  assert.equal(lookup.isUnsupportedLink("https://cdn.example.com/a.mp3"), false, "직접 링크");
});

test("스포티파이 공유 링크의 지역 경로(intl-xx/)는 같은 곡으로 알아본다", () => {
  assert.equal(lookup.detectPlatform("https://open.spotify.com/intl-ko/track/2joT0CjcGqc1fr8Fvk7itj?si=0a1b2c"), "spotify");
  assert.deepEqual(links.parseSpotifyURL("https://open.spotify.com/intl-pt-br/album/abc"), { type: "album", id: "abc" });
  assert.equal(links.isSpotifyURL("https://open.spotify.com/intl-ko/"), false);
});
