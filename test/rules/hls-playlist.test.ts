// src/rules/hls-playlist.ts: HLS 재생목록 해석(상위, 하위 목록, 바이트 구간, 초기화 세그먼트, 키, 순번, 끝)과 받을 하위 목록 고르기

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlaylist, chooseMedia, lengthOf, type MasterPlaylist, type MediaPlaylist } from "../../src/rules/hls-playlist.ts";

const BASE = "https://cdn.test/live/master.m3u8";

test("HLS 가 아니면 null", () => {
  assert.equal(parsePlaylist("<html></html>", BASE), null);
  assert.equal(parsePlaylist("[playlist]\nFile1=x", BASE), null);
});

test("상위 목록: 화질, 음성 따로를 모으고, 음성 따로(기본 먼저)를 고른다. 없으면 대역폭이 가장 낮은 화질", () => {
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

test("하위 목록: 세그먼트 길이, 순번, 끝, 바이트 구간(오프셋 없으면 같은 주소의 앞 구간 끝에서), 초기화 세그먼트, 키는 바뀔 때까지 이어진다", () => {
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
  assert.equal(two.init?.url, one.init?.url, "초기화 세그먼트가 이어진다");
  assert.equal(one.key?.method, "AES-128");
  assert.equal(one.key?.url, "https://keys.test/k1");
  assert.deepEqual([...(one.key?.iv ?? [])].slice(-2), [0, 42]);
  assert.deepEqual([three.key, three.discontinuity, three.sequence, three.range], [null, true, 43, null]);
  assert.equal(lengthOf(media), 16.49);
});

test("http(s) 가 아닌 주소(file, data, 그 밖)는 버리고, 그 밖의 암호는 OTHER(SAMPLE-AES 등)", () => {
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

test("하위 목록의 비정상 값: 목표 길이는 0 ~ 60초, 세그먼트 길이는 유한한 수로 맞추고 순번은 안전한 정수만 받는다", () => {
  const huge = "9".repeat(400);
  const media = parsePlaylist(`#EXTM3U\n#EXT-X-TARGETDURATION:Infinity\n#EXT-X-MEDIA-SEQUENCE:x\n#EXTINF:Infinity,\na.ts\n#EXTINF:-3,\nb.ts\n#EXTINF:4,\nc.ts\n`, BASE) as MediaPlaylist;
  assert.deepEqual([media.targetDuration, media.mediaSequence], [0, 0]);
  assert.deepEqual(
    media.segments.map((s) => [s.duration, s.sequence, s.range]),
    [
      [0, 0, null],
      [0, 1, null],
      [4, 2, null],
    ],
  );
  for (const big of [huge, "9007199254740992"]) {
    assert.throws(() => parsePlaylist(`#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${big}\n#EXTINF:4,\na.ts\n`, BASE), { code: "unsupported-link" }, "0으로 바꾸면 복호화의 IV, 이어받기가 틀린다");
  }
  const long = parsePlaylist(`#EXTM3U\n#EXT-X-TARGETDURATION:3000000\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:1e300,\na.ts\n`, BASE) as MediaPlaylist;
  assert.deepEqual([long.targetDuration, long.mediaSequence, long.segments[0].duration], [60, 7, 86_400]);
});

test("읽을 수 없는 바이트 구간(길이 0, 안전한 정수를 넘음, 빈 값, 끝이 넘침)은 그것을 쓰는 세그먼트에서 unsupported-link를 던진다. 파일 전체 다운로드로 바꾸지 않는다", () => {
  const huge = "9".repeat(400);
  const max = "9007199254740991";
  for (const range of [`${huge}@0`, "0@10", "", `2@${max}`, "x"]) {
    assert.throws(() => parsePlaylist(`#EXTM3U\n#EXTINF:4,\n#EXT-X-BYTERANGE:${range}\nmain.mp4\n`, BASE), { code: "unsupported-link" }, range);
  }
  // 오프셋 없이 이어지는 위치가 넘친다
  assert.throws(() => parsePlaylist(`#EXTM3U\n#EXTINF:4,\n#EXT-X-BYTERANGE:${max}@0\nmain.mp4\n#EXTINF:4,\n#EXT-X-BYTERANGE:2\nmain.mp4\n`, BASE), { code: "unsupported-link" });
  assert.throws(() => parsePlaylist(`#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="0@0"\n#EXTINF:4,\nseg.m4s\n`, BASE), { code: "unsupported-link" }, "초기화 세그먼트의 구간도");
  // 갱신 중에 받아 끝이 잘린 라이브 목록: 그 구간을 쓰는 세그먼트가 없으니 읽는다
  const cut = parsePlaylist(`#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\n#EXT-X-BYTERANGE:`, BASE) as MediaPlaylist;
  assert.equal(cut.segments.length, 1);
  const ok = parsePlaylist(`#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\n#EXT-X-BYTERANGE:4@4\nmain.mp4\n`, BASE) as MediaPlaylist;
  assert.deepEqual([ok.segments[0].range, ok.segments[0].init?.range], [{ length: 4, offset: 4 }, null], "구간이 없는 것은 그대로 null");
});
