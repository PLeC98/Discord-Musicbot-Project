// 라이브 스트림 차단. 라이브는 duration 이 0 이라 길이 신호가 죽어 동등물로 뽑힐 수 있고(제목이 기호뿐인 곡 등),
// 캐시 다운로드가 시작되면 yt-dlp 가 외부 다운로더로 띄운 ffmpeg 가 끝나지 않는 방송을 받아 파일이 끝없이 커진다.
//
// 방어선 3중: (1) 매칭 후보에서 라이브 제외 (2) track.isLive면 다운로드 미시작 (3) yt-dlp --match-filter "!is_live"

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as stores from "../../src/store/stores.ts";

// 동등물 찾기가 링크 데이터를 타므로 임시 DB로 돌린다 — 운영 DB 미접촉.
const DB_DIR = path.join(os.tmpdir(), `musicbot-livestream-test-${process.pid}`);
const audioCache = await import("../../src/store/audio-cache.ts");
stores.open(DB_DIR);
audioCache.initialize();
after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
});

const YouTube = await import("../../src/sources/youtube/index.ts");
const equivalent = await import("../../src/sources/youtube/equivalent.ts");
// 라이브러리가 플래그를 인자로 펴는 함수. 내보내지만 타입에는 없다
const { args: argsOf } = (await import("youtube-dl-exec")).default as unknown as { args(flags: object): string[] };

test("_detectLive: is_live / live_status의 라이브·예정만 참", () => {
  assert.equal(YouTube._detectLive({ is_live: true }), true);
  assert.equal(YouTube._detectLive({ live_status: "is_live" }), true);
  assert.equal(YouTube._detectLive({ live_status: "is_upcoming" }), true);

  // 종료된 라이브(was_live)와 후처리 중(post_live)은 길이가 확정된 일반 영상 — 다운로드해도 된다.
  assert.equal(YouTube._detectLive({ live_status: "was_live" }), false);
  assert.equal(YouTube._detectLive({ live_status: "post_live" }), false);
  assert.equal(YouTube._detectLive({ live_status: "not_live" }), false);
  assert.equal(YouTube._detectLive({ is_live: false }), false);
  assert.equal(YouTube._detectLive({}), false);
  assert.equal(YouTube._detectLive(null), false);
});

test("findYouTubeEquivalent: 라이브 후보는 제외된다 (라이브만 있으면 null)", async () => {
  const search = async () => [
    // 유일한 후보가 라이브 — 예전 코드라면 이게 우승해서 무한 다운로드로 이어졌다.
    { id: "L".repeat(11), url: "https://www.youtube.com/watch?v=LLLLLLLLLLL", title: "24/7 kids anime live", artist: "SomeChannel", duration: 0, isLive: true },
  ];

  const track = { title: "''''''", artist: "x0o0x_", duration: 200, platform: "spotify", url: "https://open.spotify.com/track/abc" };
  const result = await equivalent.findYouTubeEquivalent(track, { search });
  assert.equal(result, null, "라이브만 남으면 매칭 실패로 끝나야 한다 — 라이브를 골라선 안 된다");
  assert.equal(Reflect.get(track, "youtubeUrl"), undefined);
});

test("findYouTubeEquivalent: 라이브가 섞여 있으면 비라이브 후보가 선택된다", async () => {
  const search = async () => [
    { id: "L".repeat(11), url: "https://www.youtube.com/watch?v=LLLLLLLLLLL", title: "테스트곡 live stream", artist: "테스트가수", duration: 0, isLive: true },
    { id: "V".repeat(11), url: "https://www.youtube.com/watch?v=VVVVVVVVVVV", title: "테스트곡", artist: "테스트가수", duration: 200, isLive: false },
  ];

  const track = { title: "테스트곡", artist: "테스트가수", duration: 200, platform: "spotify", url: "https://open.spotify.com/track/def" };
  const result = await equivalent.findYouTubeEquivalent(track, { search });
  assert.equal(result, "https://www.youtube.com/watch?v=VVVVVVVVVVV");
});

test("다운로드 옵션에 --match-filter !is_live 가 실린다 (yt-dlp 자체 2차 방어선)", () => {
  const args = argsOf(YouTube.getYtDlpOptions({ matchFilter: "!is_live" }));
  const i = args.indexOf("--match-filter");
  assert.ok(i >= 0, "--match-filter 플래그가 생성되어야 함");
  assert.equal(args[i + 1], "!is_live");
});
