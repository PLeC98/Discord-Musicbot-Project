// src/rules/hls-playlist.ts — HLS 재생목록 해석(상위 · 하위 목록, 바이트 구간 · 머리 조각 · 키 · 순번 · 끝)과 받을 하위 목록 고르기

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlaylist, chooseMedia, lengthOf, type MasterPlaylist, type MediaPlaylist } from "../../src/rules/hls-playlist.ts";

const BASE = "https://cdn.test/live/master.m3u8";

test("HLS 가 아니면 null", () => {
  assert.equal(parsePlaylist("<html></html>", BASE), null);
  assert.equal(parsePlaylist("[playlist]\nFile1=x", BASE), null);
});

test("상위 목록: 화질 · 음성 따로를 모으고, 음성 따로(기본 먼저)를 고른다. 없으면 대역폭이 가장 낮은 화질", () => {
  const master = parsePlaylist(
    `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",NAME="Eng",DEFAULT=NO,AUTOSELECT=YES,URI="a1/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",NAME="Main",DEFAULT=YES,AUTOSELECT=YES,URI="a2/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",URI="s/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud1"
v720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=250000,CODECS="avc1.42000d,mp4a.40.5"
v240/index.m3u8
`,
    BASE,
  ) as MasterPlaylist;
  assert.equal(master.kind, "master");
  assert.deepEqual(
    master.variants.map((v) => [v.url, v.bandwidth]),
    [
      ["https://cdn.test/live/v720/index.m3u8", 2000000],
      ["https://cdn.test/live/v240/index.m3u8", 250000],
    ],
  );
  assert.equal(chooseMedia(master), "https://cdn.test/live/a2/index.m3u8", "음성 따로, 기본 먼저");
  assert.equal(chooseMedia({ ...master, audio: [] }), "https://cdn.test/live/v240/index.m3u8", "대역폭이 가장 낮은 화질");
});

test("하위 목록: 조각 길이 · 순번 · 끝, 바이트 구간(오프셋 없으면 같은 주소의 앞 구간 끝에서), 머리 조각 · 키는 바뀔 때까지 이어진다", () => {
  const media = parsePlaylist(
    `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:41
#EXT-X-MAP:URI="main.mp4",BYTERANGE="616@0"
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.test/k1",IV=0x0000000000000000000000000000002A
#EXTINF:5.99,
#EXT-X-BYTERANGE:121090@616
main.mp4
#EXTINF:6.0,
#EXT-X-BYTERANGE:121201
main.mp4
#EXT-X-DISCONTINUITY
#EXT-X-KEY:METHOD=NONE
#EXTINF:4.5,
https://other.test/seg3.ts
#EXT-X-ENDLIST
`,
    "https://cdn.test/vod/a1/prog_index.m3u8",
  ) as MediaPlaylist;
  assert.deepEqual([media.kind, media.targetDuration, media.mediaSequence, media.ended], ["media", 6, 41, true]);
  const [one, two, three] = media.segments;
  assert.deepEqual([one.url, one.sequence, one.duration, one.range], ["https://cdn.test/vod/a1/main.mp4", 41, 5.99, { offset: 616, length: 121090 }]);
  assert.deepEqual(two.range, { offset: 121706, length: 121201 }, "오프셋 없는 구간은 앞 구간 끝에서");
  assert.deepEqual(one.init, { url: "https://cdn.test/vod/a1/main.mp4", range: { offset: 0, length: 616 } });
  assert.equal(two.init?.url, one.init?.url, "머리 조각이 이어진다");
  assert.equal(one.key?.method, "AES-128");
  assert.equal(one.key?.url, "https://keys.test/k1");
  assert.deepEqual([...(one.key?.iv ?? [])].slice(-2), [0, 42]);
  assert.deepEqual([three.key, three.discontinuity, three.sequence, three.range], [null, true, 43, null]);
  assert.equal(lengthOf(media), 16.49);
});

test("http(s) 가 아닌 주소(file · data · 그 밖)는 버리고, 그 밖의 암호는 OTHER(SAMPLE-AES 등)", () => {
  const media = parsePlaylist(
    `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm"
#EXTINF:6,
file:///etc/passwd
#EXTINF:6,
data:text/plain,abc
#EXTINF:6,
//cdn2.test/ok.ts
`,
    BASE,
  ) as MediaPlaylist;
  assert.deepEqual(
    media.segments.map((s) => s.url),
    ["https://cdn2.test/ok.ts"],
  );
  assert.equal(media.segments[0].key?.method, "OTHER");
  assert.equal(media.segments[0].key?.url, null, "http(s) 가 아닌 키 주소는 없음");
  assert.equal(media.ended, false, "끝 표시가 없으면 라이브");
});
