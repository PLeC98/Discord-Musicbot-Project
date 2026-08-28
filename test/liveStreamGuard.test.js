"use strict";

// 라이브 스트림 차단 — 캐시 다운로드가 끝나지 않아 ffmpeg가 무한히 파일을 불리던 문제의 방어선.
//
// 회귀 시나리오: 제목이 기호뿐인 Spotify 트랙("''''''")의 YouTube 동등물로
// 어린이 애니메이션 "라이브 방송"이 선택됐다. 라이브는 duration이 0이라 길이 신호가 죽고,
// 후보에서 걸러지지도 않아 우승했다. 그 뒤 캐시 다운로드가 시작되면 yt-dlp가 ffmpeg를
// 외부 다운로더로 띄우는데 방송이 끝나지 않으니 파일이 무한히 커지고, 봇을 죽여도 ffmpeg가 남았다.
//
// 방어선 3중: (1) 매칭 후보에서 라이브 제외 (2) track.isLive면 다운로드 미시작 (3) yt-dlp --match-filter "!is_live"

process.env.COOKIES_FROM_BROWSER = "";
process.env.COOKIES_FILE = "";

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

// TrackResolver가 CacheManager(해석 캐시 조회)를 타므로 임시 DB로 돌린다 — 운영 DB 미접촉.
const TEST_DB = path.join(os.tmpdir(), `musicbot-livestream-test-${process.pid}.db`);
const CacheManager = require("../src/CacheManager");
CacheManager.initialize(TEST_DB);
after(() => {
  CacheManager.close();
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* 없으면 무시 */
    }
  }
});

const YouTube = require("../src/YouTube");

test("_detectLive: is_live / live_status의 라이브·예정만 참", () => {
  assert.equal(YouTube._detectLive({ is_live: true }), true);
  assert.equal(YouTube._detectLive({ live_status: "is_live" }), true);
  assert.equal(YouTube._detectLive({ live_status: "is_upcoming" }), true);

  // 종료된 라이브(was_live)와 후처리 중(post_live)은 길이가 확정된 일반 영상 — 받아도 된다.
  assert.equal(YouTube._detectLive({ live_status: "was_live" }), false);
  assert.equal(YouTube._detectLive({ live_status: "post_live" }), false);
  assert.equal(YouTube._detectLive({ live_status: "not_live" }), false);
  assert.equal(YouTube._detectLive({ is_live: false }), false);
  assert.equal(YouTube._detectLive({}), false);
  assert.equal(YouTube._detectLive(null), false);
});

test("findYouTubeEquivalent: 라이브 후보는 제외된다 (라이브만 있으면 null)", async () => {
  const resolverPath = require.resolve(path.join(__dirname, "..", "src", "TrackResolver.js"));
  delete require.cache[resolverPath];

  const originalSearch = YouTube.search;
  YouTube.search = async () => [
    // 유일한 후보가 라이브 — 예전 코드라면 이게 우승해서 무한 다운로드로 이어졌다.
    { id: "L".repeat(11), url: "https://www.youtube.com/watch?v=LLLLLLLLLLL", title: "24/7 kids anime live", artist: "SomeChannel", duration: 0, isLive: true },
  ];

  try {
    const TrackResolver = require(resolverPath);
    const track = { title: "''''''", artist: "x0o0x_", duration: 200, platform: "spotify", url: "https://open.spotify.com/track/abc" };
    const result = await TrackResolver.findYouTubeEquivalent(track, null);
    assert.equal(result, null, "라이브만 남으면 매칭 실패로 끝나야 한다 — 라이브를 골라선 안 된다");
    assert.equal(track.youtubeUrl, undefined);
  } finally {
    YouTube.search = originalSearch;
    delete require.cache[resolverPath];
  }
});

test("findYouTubeEquivalent: 라이브가 섞여 있으면 비라이브 후보가 선택된다", async () => {
  const resolverPath = require.resolve(path.join(__dirname, "..", "src", "TrackResolver.js"));
  delete require.cache[resolverPath];

  const originalSearch = YouTube.search;
  YouTube.search = async () => [
    { id: "L".repeat(11), url: "https://www.youtube.com/watch?v=LLLLLLLLLLL", title: "테스트곡 live stream", artist: "테스트가수", duration: 0, isLive: true },
    { id: "V".repeat(11), url: "https://www.youtube.com/watch?v=VVVVVVVVVVV", title: "테스트곡", artist: "테스트가수", duration: 200, isLive: false },
  ];

  try {
    const TrackResolver = require(resolverPath);
    const track = { title: "테스트곡", artist: "테스트가수", duration: 200, platform: "spotify", url: "https://open.spotify.com/track/def" };
    const result = await TrackResolver.findYouTubeEquivalent(track, null);
    assert.equal(result, "https://www.youtube.com/watch?v=VVVVVVVVVVV");
  } finally {
    YouTube.search = originalSearch;
    delete require.cache[resolverPath];
  }
});

test("다운로드 옵션에 --match-filter !is_live 가 실린다 (yt-dlp 자체 2차 방어선)", () => {
  const args = require("youtube-dl-exec").args(YouTube.getYtDlpOptions({ matchFilter: "!is_live" }));
  const i = args.indexOf("--match-filter");
  assert.ok(i >= 0, "--match-filter 플래그가 생성되어야 함");
  assert.equal(args[i + 1], "!is_live");
});
