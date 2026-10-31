// src/rules/links.ts, input-kind.ts, canonical-url.ts, audio-key-of.ts: 링크 판정의 경계 입력과 그 답을 한 표로 묶는다.
// 판정(누가 다루나), 꺼낸 id, 키, 다듬은 주소가 서로 맞는지 한눈에 보려고 한 줄에 같이 적는다.
// 입력은 판정을 다시 짤 때 갈리기 쉬운 것들이다: 앞의 특수 공백, 보이지 않는 글자, 사용자 이름과 포트, 대소문자, 지역 칸, 빈 칸, 끝 점, id 뒤 글자, 재생목록 값.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inputKind } from "../../src/rules/input-kind.ts";
import { canonicalUrl } from "../../src/rules/canonical-url.ts";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";
import { extractVideoId, extractPlaylistId, isYouTubePlaylist, parseSpotifyURL, parseSoundCloudURL } from "../../src/rules/links.ts";

type Answer = { kind: string; video?: string | null; list?: string | null; playlist?: boolean; spotify?: { type: string | null; id: string | null }; sc?: string | null; key: string | null; canonical: string };

// 판정이 그 사이트면 그 사이트의 꺼내기도 같이 본다
function answerOf(input: string): Answer {
  const kind = inputKind(input);
  const answer: Answer = { kind, key: null, canonical: "" };
  if (kind === "youtube") Object.assign(answer, { video: extractVideoId(input), list: extractPlaylistId(input), playlist: isYouTubePlaylist(input) });
  if (kind === "spotify") answer.spotify = parseSpotifyURL(input);
  if (kind === "soundcloud") answer.sc = parseSoundCloudURL(input);
  answer.key = audioKeyOf(input);
  answer.canonical = canonicalUrl(input);
  return answer;
}

const CASES: Array<[string, Answer]> = [
  ["\u00a0https://youtu.be/abcdefghijk", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["\u3000https://soundcloud.com/artist/track", { kind: "unknown", key: null, canonical: "\u3000https://soundcloud.com/artist/track" }],
  ["\ufeffhttps://open.spotify.com/track/abc123", { kind: "unknown", key: null, canonical: "\ufeffhttps://open.spotify.com/track/abc123" }],
  ["https://youtu.be/abcdefghijk\u200b", { kind: "unknown", key: null, canonical: "https://youtu.be/abcdefghijk\u200b" }],
  ["https://www.youtube.com/watch?v=abcdefghijk\nhttps://youtu.be/x", { kind: "unknown", key: null, canonical: "https://www.youtube.com/watch?v=abcdefghijk\nhttps://youtu.be/x" }],
  ["https://user:pw@www.youtube.com/watch?v=abcdefghijk", { kind: "unknown", key: null, canonical: "https://user:pw@www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com:8443/watch?v=abcdefghijk", { kind: "unknown", key: null, canonical: "https://www.youtube.com:8443/watch?v=abcdefghijk" }],
  ["https://youtu.be/abcdefghijk.x", { kind: "unknown", key: null, canonical: "https://youtu.be/abcdefghijk.x" }],
  ["https://www.youtube.com/shorts/abcdefghijk.x", { kind: "unknown", key: null, canonical: "https://www.youtube.com/shorts/abcdefghijk.x" }],
  ["https://www.youtube.com/embed/abcdefghijk.x", { kind: "unknown", key: null, canonical: "https://www.youtube.com/embed/abcdefghijk.x" }],
  ["https://www.youtube.com/embed/videoseries?list=PLabcdefghij", { kind: "youtube", video: null, list: "PLabcdefghij", playlist: true, key: null, canonical: "https://www.youtube.com/embed/videoseries?list=PLabcdefghij" }],
  ["https://www.youtube.com/shorts/abcdefghijk/", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/watch?list=PLabcdefghij", { kind: "youtube", video: null, list: "PLabcdefghij", playlist: true, key: null, canonical: "https://www.youtube.com/watch?list=PLabcdefghij" }],
  ["https://www.youtube.com/watch?v=abcdefghijk&list=PLabc<x>", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/watch?v=abcdefghijk&list=PLabc+y", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/watch?v=abcdefghijk&list=&list=PLyyy", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/watch?v=abcdefghijk#t=3&list=PLabc", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/watch?v=abcdefghijk?list=PLabc", { kind: "unknown", key: null, canonical: "https://www.youtube.com/watch?v=abcdefghijk?list=PLabc" }],
  ["https://www.youtube.com/watch?v=abcdefghijk&list=PL%2Dabc", { kind: "youtube", video: "abcdefghijk", list: "PL-abc", playlist: true, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/watch?v=abcdefghijk&%6cist=PLabc", { kind: "youtube", video: "abcdefghijk", list: "PLabc", playlist: true, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://open.spotify.com/track/abc-def", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["https://open.spotify.com/track/X%41", { kind: "spotify", spotify: { type: "track", id: "X" }, key: null, canonical: "https://open.spotify.com/track/X" }],
  ["https://OPEN.SPOTIFY.COM/track/abc", { kind: "unknown", key: null, canonical: "https://OPEN.SPOTIFY.COM/track/abc" }],
  ["HTTPS://open.spotify.com/track/abc", { kind: "unknown", key: null, canonical: "HTTPS://open.spotify.com/track/abc" }],
  ["https://open.spotify.com/intl-pt-BR/track/abc", { kind: "unknown", key: null, canonical: "https://open.spotify.com/intl-pt-BR/track/abc" }],
  ["https://open.spotify.com//track/abc", { kind: "unknown", key: null, canonical: "https://open.spotify.com//track/abc" }],
  ["https://open.spotify.com/intl-ko/track/abc?si=x", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["https://open.spotify.com/track/abc/extra", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["spotify:track:abc#0:45", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["spotify:track:abc/", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["spotify:track:abc:extra", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["spotify:track:abc?si=y", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["SPOTIFY:track:abc", { kind: "search", key: null, canonical: "SPOTIFY:track:abc" }],
  ["spotify:track:abc-def", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["spotify: 아이유 좋은 날", { kind: "search", key: null, canonical: "spotify: 아이유 좋은 날" }],
  ["https://evilspotify.com/track/abc", { kind: "direct", key: "dl:9e09902a06876717a540d635ece96196", canonical: "https://evilspotify.com/track/abc" }],
  ["ftp://open.spotify.com/track/abc", { kind: "unknown", key: null, canonical: "ftp://open.spotify.com/track/abc" }],
  ["https://u:p@open.spotify.com/track/abc", { kind: "unknown", key: null, canonical: "https://u:p@open.spotify.com/track/abc" }],
  ["https://open.spotify.com:8443/track/abc", { kind: "unknown", key: null, canonical: "https://open.spotify.com:8443/track/abc" }],
  ["https://soundcloud.com./artist/track", { kind: "unknown", key: null, canonical: "https://soundcloud.com./artist/track" }],
  ["https://on.soundcloud.com./AbCd", { kind: "unknown", key: null, canonical: "https://on.soundcloud.com./AbCd" }],
  ["https://soundcloud.com/a.b/track", { kind: "unknown", key: null, canonical: "https://soundcloud.com/a.b/track" }],
  ["https://soundcloud.com/artist//track", { kind: "unknown", key: null, canonical: "https://soundcloud.com/artist//track" }],
  ["https://soundcloud.com/artist/", { kind: "unknown", key: null, canonical: "https://soundcloud.com/artist/" }],
  ["https://soundcloud.com/artist?utm_source=x", { kind: "unknown", key: null, canonical: "https://soundcloud.com/artist?utm_source=x" }],
  ["https://soundcloud.com/search?q=x", { kind: "unknown", key: null, canonical: "https://soundcloud.com/search?q=x" }],
  ["https://soundcloud.com/search/sounds?q=x", { kind: "soundcloud", sc: "track", key: "sc:search/sounds", canonical: "https://soundcloud.com/search/sounds" }],
  ["https://SOUNDCLOUD.COM/artist/track", { kind: "unknown", key: null, canonical: "https://SOUNDCLOUD.COM/artist/track" }],
  ["HTTPS://soundcloud.com/artist/track", { kind: "unknown", key: null, canonical: "HTTPS://soundcloud.com/artist/track" }],
  ["https://soundcloud.com/artist/track/s-AbC123", { kind: "soundcloud", sc: "track", key: "sc:artist/track/s-AbC123", canonical: "https://soundcloud.com/artist/track/s-AbC123" }],
  ["https://soundcloud.com/artist/sets/list/s-XyZ9", { kind: "soundcloud", sc: "set", key: "sc:artist/sets/list/s-XyZ9", canonical: "https://soundcloud.com/artist/sets/list/s-XyZ9" }],
  ["https://soundcloud.com/artist/track.mp3", { kind: "soundcloud", sc: "track", key: "sc:artist/track.mp3", canonical: "https://soundcloud.com/artist/track.mp3" }],
  ["https://youtu.be/abcdefghijk/extra", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://youtu.be/abcdefghijk/", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://youtu.be/abcdefghijk?list=PLabcdefghij", { kind: "youtube", video: "abcdefghijk", list: "PLabcdefghij", playlist: true, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/shorts/abcdefghijk/extra", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/live/abcdefghijk?feature=share", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/embed/abcdefghijk?list=PLabcdefghij", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/embed/live_stream?channel=UCx", { kind: "unknown", key: null, canonical: "https://www.youtube.com/embed/live_stream?channel=UCx" }],
  ["https://www.youtube.com/watch/?v=abcdefghijk", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/playlist/?list=PLabcdefghij", { kind: "youtube", video: null, list: "PLabcdefghij", playlist: true, key: null, canonical: "https://www.youtube.com/playlist/?list=PLabcdefghij" }],
  ["https://www.youtube.com/playlist?list=PLabcdefghij", { kind: "youtube", video: null, list: "PLabcdefghij", playlist: true, key: null, canonical: "https://www.youtube.com/playlist?list=PLabcdefghij" }],
  ["https://music.youtube.com/watch?v=abcdefghijk&list=RDAMVMabcdefghijk", { kind: "youtube", video: "abcdefghijk", list: "RDAMVMabcdefghijk", playlist: true, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com:443/watch?v=abcdefghijk", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com./watch?v=abcdefghijk", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://WWW.YOUTUBE.COM/watch?v=abcdefghijk", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/channel/UCabc?list=PLabcdefghij", { kind: "unknown", key: null, canonical: "https://www.youtube.com/channel/UCabc?list=PLabcdefghij" }],
  ["https://www.youtube.com/watch?v=abcdefghijk&label=a b", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://www.youtube.com/wat ch?v=abcdefghijk", { kind: "unknown", key: null, canonical: "https://www.youtube.com/wat ch?v=abcdefghijk" }],
  ["https://www.youtu.be/abcdefghijk", { kind: "unknown", key: null, canonical: "https://www.youtu.be/abcdefghijk" }],
  [" https://youtu.be/abcdefghijk ", { kind: "youtube", video: "abcdefghijk", list: null, playlist: false, key: "yt:abcdefghijk", canonical: "https://www.youtube.com/watch?v=abcdefghijk" }],
  ["https://open.spotify.com/track/abc?label=a b", { kind: "spotify", spotify: { type: "track", id: "abc" }, key: null, canonical: "https://open.spotify.com/track/abc" }],
  ["https://soundcloud.com/artist/track?label=a b", { kind: "soundcloud", sc: "track", key: "sc:artist/track", canonical: "https://soundcloud.com/artist/track" }],
];

test("링크 판정의 경계 입력: 판정, 꺼낸 id, 키, 다듬은 주소", () => {
  for (const [input, expected] of CASES) {
    assert.deepEqual(answerOf(input), expected, JSON.stringify(input));
  }
});
