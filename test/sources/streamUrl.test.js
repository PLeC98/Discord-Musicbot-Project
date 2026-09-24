// src/sources/streamUrl.ts — 재생용 스트림을 어디서 가져올지 고르는 자리. 곡이 어디서 왔는지(platform)가 아니라 음원 주소가 정한다.
//
// 회귀 대상: 자동재생 소스가 늘면서 platform 값이 vocadb·lastfm·lbradio·touhoudb 같은 것이
// 되었는데, 이 스위치는 youtube/spotify/soundcloud/direct만 알고 나머지를 던졌다.
//   ERROR 지원되지 않는 플랫폼: vocadb
// 캐시에 받아 둔 곡은 파일로 재생돼서 멀쩡했고, 안 받아 둔 곡만 죽었다 —
// 그래서 "두 곡은 되다가 갑자기 안 되는" 모양으로 나타났다.

import { test } from "node:test";
import assert from "node:assert/strict";

// 실제로 유튜브에 붙지 않는다 — 어느 주소로 가는지만 본다
let asked = null;
const youtube = {
  getStream: async (url, seek) => {
    asked = { url, seek };
    return { fake: true };
  },
  isVideoUnavailableError: () => false,
};

const streamUrl = (await import("../../src/sources/streamUrl.ts")).default;

test("출처가 따로 있는 곡은 찾아 둔 영상에서 소리를 가져온다", async () => {
  for (const platform of ["vocadb", "touhoudb", "utaitedb", "lastfm", "lbradio", "animethemes"]) {
    asked = null;
    const track = { platform, pageUrl: `https://${platform}.example/song/1`, audioUrl: "https://www.youtube.com/watch?v=abc", title: "곡" };

    await streamUrl.getStream(track, 12, { youtube });

    assert.equal(asked.url, "https://www.youtube.com/watch?v=abc", `${platform}: 출처 주소가 아니라 영상에서 가져와야 한다`);
    assert.equal(asked.seek, 12, `${platform}: 이어듣기 위치도 그대로 넘겨야 한다`);
  }
});

test("유튜브 곡은 그대로 자기 주소를 쓴다", async () => {
  asked = null;
  await streamUrl.getStream({ platform: "youtube", audioUrl: "https://www.youtube.com/watch?v=zzz" }, 0, { youtube });
  assert.equal(asked.url, "https://www.youtube.com/watch?v=zzz");
});

test("음원을 직접 트는 곡은 주소 서술자만 돌려준다 — 여기서 열면 프리로드가 연결을 흘린다", async () => {
  const got = await streamUrl.getStream({ platform: "animethemes", audioUrl: "https://a.animethemes.moe/X.ogg" }, 0, { youtube });
  assert.deepEqual(got, { url: "https://a.animethemes.moe/X.ogg", platform: "direct", httpHeaders: {} });
});

test("음원 주소가 모르는 사이트면 거절한다", async () => {
  await assert.rejects(() => streamUrl.getStream({ platform: "없는것", audioUrl: "https://example.com/page" }, 0, { youtube }), /지원되지 않는 음원 주소/);
});
