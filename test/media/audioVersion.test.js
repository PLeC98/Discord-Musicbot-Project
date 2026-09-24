// src/media/audioVersion.ts — 받은 음원의 판. 받을 때 같은 응답에서 읽는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import audioVersion from "../../src/media/audioVersion.ts";
const { fromYtDlpInfo, fromHeaders } = audioVersion;

test("yt-dlp info: 유튜브는 포맷 주소의 lmt, 사운드클라우드는 경로 첫 칸이나 수정 시각", () => {
  const cases = [
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
