// src/media/audio-version.ts — 다운로드한 음원의 버전. 다운로드할 때 같은 응답에서 읽는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fromYtDlpInfo, fromHeaders, lmtsOf, lmtOf, audioDurationOf, sameDirect } from "../../src/media/audio-version.ts";

test("yt-dlp info: 유튜브는 포맷 주소의 lmt, 사운드클라우드는 경로 첫 세그먼트나 수정 시각", () => {
  const cases: Array<[Parameters<typeof fromYtDlpInfo>[0], string | null]> = [
    [{ extractor_key: "Youtube", url: "https://rr1.googlevideo.com/videoplayback?itag=251&lmt=1680501254853292&x=1" }, "lmt:1680501254853292"],
    [{ extractor_key: "Soundcloud", url: "https://playback.media-streaming.soundcloud.cloud/cWHNerOLlkUq/aac_160k/abc/playlist.m3u8?x=1", modified_timestamp: 1657536958 }, "file:cWHNerOLlkUq"],
    [{ extractor_key: "Soundcloud", modified_timestamp: 1657536958 }, "modified:1657536958"],
    [{ extractor_key: "Youtube", url: "https://rr1.googlevideo.com/videoplayback?itag=251" }, null],
    [{ extractor_key: "Youtube", url: "주소가 아님" }, null],
    [null, null],
  ];
  for (const [info, want] of cases) assert.equal(fromYtDlpInfo(info), want, JSON.stringify(info));
});

test("응답 헤더: ETag · Last-Modified · Content-Length 중 있는 것을 모두 이어 붙인다", () => {
  assert.equal(fromHeaders({ etag: '"abc"', "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT", "content-length": "1234" }), 'etag="abc";modified=Wed, 01 Jan 2025 00:00:00 GMT;length=1234');
  assert.equal(fromHeaders({ "content-length": "1234" }), "length=1234");
  assert.equal(fromHeaders({ "content-type": "audio/ogg" }), null);
  assert.equal(fromHeaders(undefined), null);
});

test("구간 응답이면 크기는 Content-Range 의 전체(첫 1바이트만 받는 다시 확인)", () => {
  assert.equal(fromHeaders({ etag: '"m"', "content-length": "1", "content-range": "bytes 0-0/2321206" }), 'etag="m";length=2321206');
});

// 잰 값(비공개 시험 영상을 30초 자른 뒤): 포맷마다 lmt 가 다르고 주소의 dur 이 길이
const yt = (itag: number, lmt: string, dur: string, audio = true) => ({ format_id: String(itag), url: `https://rr1.googlevideo.com/videoplayback?itag=${itag}&lmt=${lmt}&dur=${dur}`, acodec: audio ? "opus" : "none", vcodec: audio ? "none" : "vp9" });

test("유튜브 포맷 목록: lmt 들 · 오디오 포맷의 길이, 버전 한 줄의 lmt", () => {
  const formats = [{ format_id: "sb0", url: "https://i.ytimg.com/sb/x" }, yt(160, "1792606058000000", "270.333", false), yt(251, "1792606059000000", "270.341")];
  assert.deepEqual([...lmtsOf(formats)], ["1792606058000000", "1792606059000000"]);
  assert.equal(audioDurationOf(formats), 270.341);
  assert.equal(audioDurationOf([yt(160, "1", "10", false)]), null, "영상만 있는 포맷은 오디오 길이가 아니다");
  assert.equal(lmtOf("lmt:123"), "123");
  assert.equal(lmtOf("file:x"), null);
});

test("직접 링크 두 버전: ETag > Last-Modified > 크기 중 둘 다 가진 것으로, 없으면 모름", () => {
  assert.equal(sameDirect('etag="a";modified=x;length=1', 'etag="a";modified=y;length=2'), true, "ETag 가 같으면 날짜 · 크기는 보지 않는다");
  assert.equal(sameDirect('etag="a";length=1', 'etag="b";length=1'), false);
  assert.equal(sameDirect("modified=Sun, 25 Jun 2023 04:33:06 GMT;length=1", 'etag="b";modified=Sun, 25 Jun 2023 04:33:06 GMT'), true);
  assert.equal(sameDirect("length=10", "length=11"), false);
  assert.equal(sameDirect('etag="a"', "length=1"), null);
});
