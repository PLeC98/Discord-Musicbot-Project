// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 사운드클라우드와 직접 링크가 무엇을 조회하고 무엇을 돌려주는지 고정한다(구조 리팩터링 0-B).
//
// 2a 가 링크 판정을 rules/links 로 옮기고, 3 이 사운드클라우드 열쇠 모양과 트랙 칸을 바꾼다. 사운드클라우드는 부르는 곳이
// 있는 것(링크 판정 · 검색 · 스트림)만 본다. 나머지 정적 메서드는 고아다(B-41, SC-1 때 판단).
// yt-dlp 는 youtube-dl-exec 의 exec 만, 직접 링크는 SafeUrl 의 head · getStream 만 가짜로 둔다.

import { Readable } from "node:stream";
import * as links from "../../src/rules/links.ts";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import ytdlExec from "youtube-dl-exec";
import * as SoundCloud from "../../src/sources/soundcloud.ts";
import * as DirectLink from "../../src/sources/direct.ts";

const calls = { ytdlp: [], head: [], stream: [] };
let respond;
let headReply;
const real = { exec: ytdlExec.exec };
// 직접 링크의 네트워크(SafeUrl 의 head · getStream) 가짜. DirectLink 에 넘긴다
const net = {
  head: async (url) => {
    calls.head.push(url);
    return headReply(url);
  },
  getStream: async (url) => {
    calls.stream.push(url);
    return Readable.from(["x"]);
  },
};

before(() => {
  ytdlExec.exec = (url, flags) => {
    calls.ytdlp.push({ url, flags });
    const out = respond(url, flags);
    if (out && out.fail) return Promise.reject(Object.assign(new Error("exit 1"), { stderr: out.fail }));
    return Promise.resolve({ stdout: JSON.stringify(out), stderr: "" });
  };
});

after(() => {
  ytdlExec.exec = real.exec;
});

beforeEach(() => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  respond = () => ({});
  headReply = () => ({ headers: {} });
});

const scItem = (slug, extra = {}) => ({ id: 1000 + slug.length, title: `SC ${slug}`, uploader: "올린 사람", webpage_url: `https://soundcloud.com/artist/${slug}`, duration: 180.4, thumbnail: "https://i1.sndcdn.com/a.jpg", ...extra });

// ── 사운드클라우드 ────────────────────────────────────────────────────

test("사운드클라우드 링크 판정: 곡 · 세트 · 사용자 · 앱 짧은 링크", () => {
  for (const url of ["https://soundcloud.com/artist/track-name", "https://m.soundcloud.com/artist/track", "https://soundcloud.com/artist/sets/list", "https://soundcloud.com/artist", "https://on.soundcloud.com/AbC123"]) {
    assert.equal(links.isSoundCloudURL(url), true, url);
  }
  for (const url of ["https://soundcloud.app/x/y", "https://www.youtube.com/watch?v=x", "soundcloud.com/a/b"]) {
    assert.equal(links.isSoundCloudURL(url), false, url);
  }
});

test("사운드클라우드 검색: scsearch 로 받고 사운드클라우드 주소인 항목만 표준 모양으로", async () => {
  respond = () => ({ entries: [scItem("one"), { title: "다른 곳", webpage_url: "https://example.com/x" }, scItem("two")] });

  const tracks = await SoundCloud.search("노래", 3);

  assert.equal(calls.ytdlp[0].url, "scsearch3:노래");
  assert.deepEqual({ dump: calls.ytdlp[0].flags.dumpSingleJson, flat: calls.ytdlp[0].flags.flatPlaylist, noWarnings: calls.ytdlp[0].flags.noWarnings }, { dump: true, flat: true, noWarnings: true });
  assert.deepEqual(
    tracks.map((t) => t.pageUrl),
    ["https://soundcloud.com/artist/one", "https://soundcloud.com/artist/two"],
  );
  assert.deepEqual({ title: tracks[0].title, artist: tracks[0].artist, duration: tracks[0].duration, platform: tracks[0].platform, type: tracks[0].type, id: tracks[0].id }, { title: "SC one", artist: "올린 사람", duration: 180.4, platform: "soundcloud", type: "track", id: 1003 });
});

test("사운드클라우드 검색: 주소를 주면 그 곡의 정보를, 실패하면 빈 배열", async () => {
  respond = () => scItem("direct");
  const [t] = await SoundCloud.search("https://soundcloud.com/artist/direct");
  assert.equal(calls.ytdlp[0].url, "https://soundcloud.com/artist/direct");
  assert.equal(calls.ytdlp[0].flags.flatPlaylist, undefined);
  assert.equal(t.title, "SC direct");

  respond = () => ({ fail: "ERROR: 404" });
  assert.deepEqual(await SoundCloud.search("https://soundcloud.com/artist/gone"), [], "정보 조회 실패는 null → 빈 배열");
  assert.deepEqual(await SoundCloud.search("아무거나"), []);
});

test("사운드클라우드 스트림: 서술자에 전송 방식을 싣는다. HLS 를 못 여는 빌드면 받아 합칠 수 있는 포맷을 고른다", async () => {
  respond = () => ({ url: "https://cf-hls-media.sndcdn.com/x.m3u8", protocol: "m3u8_native", duration: 180.6, abr: 96, http_headers: { A: "b" } });

  const s = await SoundCloud.getStream("https://soundcloud.com/artist/track");
  assert.deepEqual(s, { url: "https://cf-hls-media.sndcdn.com/x.m3u8", protocol: "m3u8_native", duration: 181, bitrate: 96, platform: "soundcloud", httpHeaders: { A: "b" } });
  assert.equal(calls.ytdlp[0].flags.format, "bestaudio/best", "생략하면 HLS 를 연다고 본다");

  await SoundCloud.getStream("https://soundcloud.com/artist/track", { canPlayHls: false });
  assert.equal(calls.ytdlp[1].flags.format, "bestaudio[protocol^=http]/best[protocol^=http]/bestaudio/best");
});

test("사운드클라우드 스트림: 주소가 없으면 던진다", async () => {
  respond = () => ({ title: "x" });
  await assert.rejects(SoundCloud.getStream("https://soundcloud.com/artist/track"), /스트림 URL을 찾을 수 없음/);
});

// ── 직접 링크 ─────────────────────────────────────────────────────────

test("직접 링크 판정: http(s) 이고 지원하는 확장자로 끝나야 한다(쿼리는 상관없다)", () => {
  for (const url of ["https://files.test/a.mp3", "http://x.test/b/c.FLAC", "https://cdn.test/v.webm?sig=1", "https://x.test/y.opus"]) {
    assert.equal(links.isDirectAudioLink(url), true, url);
  }
  for (const url of ["https://files.test/a.txt", "ftp://x.test/a.mp3", "https://x.test/mp3", "not a url"]) {
    assert.equal(links.isDirectAudioLink(url), false, url);
  }
});

test("직접 링크 정보: SafeUrl HEAD 로 크기와 종류를 보고 길이를 추정한다", async () => {
  headReply = () => ({ headers: { "content-type": "audio/mpeg", "content-length": "1600000" } });

  const [t] = await DirectLink.getInfo("https://files.test/my_song-name.mp3?x=1", net);

  assert.deepEqual(calls.head, ["https://files.test/my_song-name.mp3?x=1"]);
  assert.deepEqual({ title: t.title, artist: t.artist, duration: t.duration, durationSource: t.durationSource, platform: t.platform, fileSize: t.fileSize, extension: t.extension, filename: t.filename, thumbnail: t.thumbnail }, { title: "My Song Name", artist: "직접 링크", duration: 100, durationSource: "추정", platform: "direct", fileSize: 1600000, extension: ".mp3", filename: "my_song-name.mp3", thumbnail: null });
  assert.equal(t.id, Buffer.from("https://files.test/my_song-name.mp3?x=1").toString("base64").substring(0, 16));
});

test("직접 링크 길이 추정: 종류마다 비트레이트가 다르고, 크기를 모르면 0", () => {
  assert.equal(DirectLink.estimateDuration(1411000 / 8, "audio/wav"), 1);
  assert.equal(DirectLink.estimateDuration(125000, "audio/flac"), 1);
  assert.equal(DirectLink.estimateDuration(20000, "audio/ogg"), 1);
  assert.equal(DirectLink.estimateDuration(16000, "application/octet-stream"), 1, "모르면 128k");
  assert.equal(DirectLink.estimateDuration(null, "audio/mpeg"), 0);
});

test("직접 링크 정보: 지원하지 않는 링크나 HEAD 실패는 빈 배열", async () => {
  assert.deepEqual(await DirectLink.getInfo("https://files.test/a.txt", net), []);
  assert.equal(calls.head.length, 0);
  headReply = () => {
    throw new Error("SSRF 차단: 사설 주소");
  };
  assert.deepEqual(await DirectLink.getInfo("https://files.test/a.mp3", net), []);
});

test("직접 링크 스트림: SafeUrl 로 열고, 실패 사유는 숨기고 일반 문장으로 던진다", async () => {
  const s = await DirectLink.getStream("https://files.test/a.mp3", net);
  assert.ok(s instanceof Readable);
  assert.deepEqual(calls.stream, ["https://files.test/a.mp3"]);

  await assert.rejects(DirectLink.getStream("https://files.test/a.txt", net), (e) => e.message === "재생할 수 없는 링크입니다" && /지원되지 않는 직접 오디오 파일 링크/.test(e.cause.message));
  const blocked = {
    getStream: async () => {
      throw new Error("SSRF 차단: 127.0.0.1");
    },
  };
  await assert.rejects(DirectLink.getStream("https://files.test/b.mp3", blocked), (e) => e.message === "재생할 수 없는 링크입니다" && /127\.0\.0\.1/.test(e.cause.message));
});

test("파일 이름에서 제목: 구분자를 공백으로, 단어 첫 글자를 대문자로", () => {
  assert.equal(DirectLink.extractTitle("hello_world-2.mp3"), "Hello World 2");
  assert.equal(DirectLink.extractTitle(".mp3"), "Mp3", "점으로 시작하는 이름은 확장자가 아니라 이름으로 읽힌다");
});
