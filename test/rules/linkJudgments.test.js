"use strict";

// 링크 판정 셋(inputKind · canonicalUrl · audioKeyOf). 순수 함수라 입력과 답만 적는다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { inputKind } = require("../../src/rules/inputKind");
const { canonicalUrl } = require("../../src/rules/canonicalUrl");
const { audioKeyOf, md5 } = require("../../src/rules/audioKeyOf");

test("inputKind: 사이트 호스트를 먼저 보고 확장자는 마지막에 본다", () => {
  const cases = [
    ["https://www.youtube.com/watch?v=abcdefghijk", "youtube"],
    ["https://youtu.be/abcdefghijk", "youtube"],
    ["https://www.youtube.com/playlist?list=PLx", "youtube"],
    ["https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj", "spotify"],
    ["spotify:album:2joT0CjcGqc1fr8Fvk7itj", "spotify"],
    ["https://soundcloud.com/artist/track", "soundcloud"],
    ["https://soundcloud.com/artist/track.mp3", "soundcloud"],
    ["https://cdn.example.com/a.mp3", "direct"],
    // 유튜브 호스트지만 모르는 형태. 확장자가 맞으면 직접 링크가 된다(지금 답 그대로)
    ["https://www.youtube.com/clip/abc", "unknown"],
    ["https://www.youtube.com/x.mp3", "direct"],
    ["https://anilist.co/anime/1", "unknown"],
    ["http://example.com/page", "unknown"],
    ["그냥 검색어", "search"],
    ["youtube.com/watch?v=abcdefghijk", "search"], // 주소처럼 생겨도 http(s) 가 없으면 검색어다
    [undefined, "search"],
  ];
  for (const [input, want] of cases) assert.equal(inputKind(input), want, String(input));
});

test("canonicalUrl: 유튜브만 영상 id 로 모으고 나머지는 그대로", () => {
  const cases = [
    ["https://youtu.be/Lsv4wg9YU8Y?si=AbCdEf", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://music.youtube.com/watch?v=Lsv4wg9YU8Y&list=RDx", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj?si=0a1b2c", "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj?si=0a1b2c"],
    ["검색어", "검색어"],
  ];
  for (const [input, want] of cases) assert.equal(canonicalUrl(input), want, input);
  assert.equal(canonicalUrl(null), null, "글자가 아니면 그대로 돌려준다");
});

test("audioKeyOf: 플랫폼마다 열쇠 모양, 소리가 유튜브에서 오면 영상 열쇠", () => {
  assert.equal(audioKeyOf({ platform: "youtube", id: "abcdefghijk" }), "yt:abcdefghijk");
  assert.equal(audioKeyOf({ platform: "youtube", url: "https://youtu.be/abcdefghijk" }), "yt:abcdefghijk");
  assert.equal(audioKeyOf({ platform: "youtube", url: "https://example.com" }), null);
  assert.equal(audioKeyOf({ platform: "soundcloud", id: 123 }), "sc:123");
  assert.equal(audioKeyOf({ platform: "direct", url: "https://cdn.example.com/a.mp3" }), `dl:${md5("https://cdn.example.com/a.mp3")}`);
  assert.equal(audioKeyOf({ platform: "spotify", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk" }), "yt:abcdefghijk");
  assert.equal(audioKeyOf({ platform: "soundcloud", youtubeUrl: "https://youtu.be/abcdefghijk" }), "yt:abcdefghijk", "id 없는 사운드클라우드 곡은 아래 갈래로");
  assert.equal(audioKeyOf({ platform: "spotify" }), null);
  assert.equal(audioKeyOf(null), null);
});
