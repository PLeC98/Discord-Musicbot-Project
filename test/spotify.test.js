"use strict";

// Spotify 순수 함수 단위 테스트 (네트워크 없음) — URL 파싱, TOTP, 정규화, secret 추출.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Spotify = require("../src/Spotify");
const { deriveKey, totp, normApiTrack, normGqlTrack, pickImageUrl, parseSecrets } = Spotify._internals;

test("parseSpotifyURL: 타입/ID 추출 (open URL + spotify: URI)", () => {
  assert.deepEqual(Spotify.parseSpotifyURL("https://open.spotify.com/track/2tpWsVSb9UEmDRxAl1zhX1"), { type: "track", id: "2tpWsVSb9UEmDRxAl1zhX1" });
  assert.deepEqual(Spotify.parseSpotifyURL("https://open.spotify.com/playlist/abc123?si=xyz"), { type: "playlist", id: "abc123" });
  assert.deepEqual(Spotify.parseSpotifyURL("spotify:album:XYZ"), { type: "album", id: "XYZ" });
  assert.deepEqual(Spotify.parseSpotifyURL("https://example.com/track/x"), { type: null, id: null });
});

test("isSpotifyURL: 유효/무효 판별 (호스트 사칭 차단)", () => {
  assert.equal(Spotify.isSpotifyURL("https://open.spotify.com/artist/5Pwc4xIPtQLFEnJriah9YJ"), true);
  assert.equal(Spotify.isSpotifyURL("spotify:track:abc"), true);
  assert.equal(Spotify.isSpotifyURL("https://evil.example/open.spotify.com/track/123abc"), false);
  assert.equal(Spotify.isSpotifyURL("https://open.spotify.com/episode/xyz"), false); // episode 미지원
});

test("totp: RFC 6238 SHA1 테스트 벡터 (6자리)", () => {
  const key = Buffer.from("12345678901234567890", "utf8"); // RFC 6238 표준 키
  assert.equal(totp(key, 59 * 1000), "287082"); // T=59s
  assert.equal(totp(key, 1111111109 * 1000), "081804"); // T=1111111109s
});

test("totp: 같은 30초 창은 동일, 다음 창은 상이", () => {
  const key = Buffer.from("12345678901234567890", "utf8");
  const base = 60000; // 창 경계
  assert.equal(totp(key, base), totp(key, base + 29999));
  assert.notEqual(totp(key, base), totp(key, base + 30000));
});

test("deriveKey: char ^ (i%33+9) → 숫자열 UTF-8", () => {
  // 'A'(65)^9=72, 'B'(66)^10=72 → "7272"
  assert.equal(deriveKey("AB").toString("utf8"), "7272");
});

test("parseSecrets: 문자열형 secret 목록 추출 + 이스케이프 해제", () => {
  const js = `x=[{secret:'ab',version:61},{secret:'c\\\\d',version:60}].map`;
  const got = parseSecrets(js);
  assert.deepEqual(got, [
    { secret: "ab", version: 61 },
    { secret: "c\\d", version: 60 },
  ]);
});

test("pickImageUrl: 치수 있으면 최고 해상도, 없으면 640(0000b273) 우선", () => {
  assert.equal(
    pickImageUrl([
      { url: "s", height: 64 },
      { url: "l", height: 640 },
      { url: "m", height: 300 },
    ]),
    "l",
  );
  assert.equal(pickImageUrl([{ url: "https://i.scdn.co/image/ab67616d00001e02x" }, { url: "https://i.scdn.co/image/ab67616d0000b273x" }]), "https://i.scdn.co/image/ab67616d0000b273x");
  assert.equal(pickImageUrl([]), null);
  assert.equal(pickImageUrl(undefined), null);
});

test("normApiTrack: 공식 API 트랙 → 표준 스키마", () => {
  const t = normApiTrack({
    id: "abc",
    name: "곡",
    artists: [{ name: "A" }, { name: "B" }],
    duration_ms: 187413,
    external_urls: { spotify: "https://open.spotify.com/track/abc" },
    album: { name: "앨범", images: [{ url: "u", height: 640 }] },
  });
  assert.equal(t.title, "곡");
  assert.equal(t.artist, "A, B");
  assert.equal(t.duration, 187); // floor(187413/1000)
  assert.equal(t.album, "앨범");
  assert.equal(t.url, "https://open.spotify.com/track/abc");
  assert.equal(t.thumbnail, "u");
  assert.equal(t.platform, "spotify");
  assert.equal(t.id, "abc");
});

test("normApiTrack: album 트랙에 albumOverride로 앨범 메타 주입", () => {
  const t = normApiTrack({ id: "x", name: "n", artists: [{ name: "A" }], duration_ms: 1000, external_urls: { spotify: "u" } }, { name: "앨범명", images: [{ url: "cover", height: 300 }] });
  assert.equal(t.album, "앨범명");
  assert.equal(t.thumbnail, "cover");
});

test("normGqlTrack: uri→URL/id, totalMilliseconds→초, coverArt", () => {
  const t = normGqlTrack({
    uri: "spotify:track:4CeeEOM32jQcH3eN9Q2dGj",
    name: "Smells Like Teen Spirit",
    trackDuration: { totalMilliseconds: 301920 },
    artists: { items: [{ profile: { name: "Nirvana" } }] },
    albumOfTrack: { coverArt: { sources: [{ url: "https://i.scdn.co/image/ab67616d0000b273x" }] } },
  });
  assert.equal(t.id, "4CeeEOM32jQcH3eN9Q2dGj");
  assert.equal(t.url, "https://open.spotify.com/track/4CeeEOM32jQcH3eN9Q2dGj");
  assert.equal(t.title, "Smells Like Teen Spirit");
  assert.equal(t.artist, "Nirvana");
  assert.equal(t.duration, 301); // floor(301920/1000)
  assert.equal(t.thumbnail, "https://i.scdn.co/image/ab67616d0000b273x");
  assert.equal(t.platform, "spotify");
});

test("normGqlTrack: artist top-tracks 형태(duration.totalMilliseconds)도 처리", () => {
  const t = normGqlTrack({ uri: "spotify:track:z", name: "n", duration: { totalMilliseconds: 257265 }, artists: { items: [{ profile: { name: "OneRepublic" } }] } });
  assert.equal(t.duration, 257);
  assert.equal(t.album, null); // albumOfTrack.name 없음 → null
});
