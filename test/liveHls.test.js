"use strict";

// 라이브(HLS) 재생 경로의 불변식.
//
// HLS는 "받아 둔 바이트"가 아니라 "받아 올 주소"를 줘야 열리는 형식이라, 이 갈래만 ffmpeg에
// URL을 넘긴다. 나머지 스트리밍이 그 길로 새면 httpHeaders가 빠지고 폴백을 건너뛴다.
// 그리고 라이브에는 길이가 없어서, 길이를 전제하던 자리들(종료 감시·탐색·반복)이 전부 걸린다.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const MusicPlayer = require("../src/MusicPlayer");
const YouTube = require("../src/YouTube");
const { capabilities, _internals } = require("../src/ffmpegPath");

const idx = (args, flag) => args.indexOf(flag);

test("능력 확인: 우리가 깔아 주는 빌드는 https와 hls를 갖췄다", () => {
  const caps = capabilities();
  assert.equal(caps.https, true, "https 프로토콜이 있어야 라이브 주소를 연다");
  assert.equal(caps.hls, true, "hls 디먹서가 있어야 재생목록을 읽는다");
  assert.equal(caps.ok, true);
  assert.equal(typeof caps.segMaxRetry, "boolean", "세그먼트 재시도 옵션은 있고 없고를 가린다");
});

test("능력 확인 결과는 캐시된다 — 재생할 때마다 프로세스를 띄우지 않는다", () => {
  assert.equal(capabilities(), capabilities(), "동일 객체를 돌려줘야 함");
});

test("liveStatusOf: 방송 중과 시작 전을 가른다", () => {
  // _detectLive는 둘 다 참이라 "라이브 계열인가"만 답한다. 재생은 이 둘을 다르게 다뤄야 한다.
  assert.equal(YouTube.liveStatusOf({ live_status: "is_live" }), "is_live");
  assert.equal(YouTube.liveStatusOf({ live_status: "is_upcoming" }), "is_upcoming");
  assert.equal(YouTube.liveStatusOf({ live_status: "was_live" }), null, "끝난 방송은 VOD다");
  assert.equal(YouTube.liveStatusOf({ live_status: "not_live" }), null);
  assert.equal(YouTube.liveStatusOf({}), null);
  assert.equal(YouTube.liveStatusOf(null), null);
  // live_status를 안 주는 응답(flat 검색 항목 등)에서는 is_live만 보고 판단한다.
  assert.equal(YouTube.liveStatusOf({ is_live: true }), "is_live");
  // 다만 live_status가 명시됐다면 그쪽이 정본이다 — was_live인데 is_live가 남아 오는 경우.
  assert.equal(YouTube.liveStatusOf({ live_status: "was_live", is_live: true }), null);
});

test("isHlsStream: m3u8 계열만 참", () => {
  assert.equal(MusicPlayer.isHlsStream({ protocol: "m3u8_native" }), true);
  assert.equal(MusicPlayer.isHlsStream({ protocol: "m3u8" }), true);
  assert.equal(MusicPlayer.isHlsStream({ protocol: "https" }), false);
  assert.equal(MusicPlayer.isHlsStream({ protocol: "http_dash_segments" }), false);
  assert.equal(MusicPlayer.isHlsStream({}), false);
  assert.equal(MusicPlayer.isHlsStream(null), false);
  assert.equal(MusicPlayer.isHlsStream("https://x/y.m3u8"), false, "문자열 서술자에는 방식 정보가 없다");
});

test("URL 입력: 주소는 -i 바로 뒤에 온다", () => {
  const url = "https://manifest.googlevideo.com/api/manifest/hls_playlist/x/index.m3u8";
  const args = MusicPlayer.buildFfmpegArgs({ url });
  assert.equal(args[idx(args, "-i") + 1], url);
  assert.deepEqual(args.slice(-7), ["-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"]);
});

test("URL 입력: 잔끊김은 ffmpeg가 먹되 EOF로는 재접속하지 않는다", () => {
  const args = MusicPlayer.buildFfmpegArgs({ url: "https://x/index.m3u8" });
  for (const flag of ["-reconnect", "-reconnect_streamed", "-reconnect_on_network_error"]) {
    assert.equal(args[idx(args, flag) + 1], "1", `${flag}가 켜져 있어야 함`);
    assert.ok(idx(args, flag) < idx(args, "-i"), `${flag}는 입력 옵션이라 -i 앞이어야 함`);
  }
  // 라이브에서 EOF는 "방송이 끝났다"다. 켜면 그걸 오류로 보고 영영 다시 붙는다.
  assert.equal(idx(args, "-reconnect_at_eof"), -1);
});

test("URL 입력: -seg_max_retry는 빌드가 아는 경우에만 붙인다", () => {
  // ffmpeg는 모르는 옵션을 치명적 오류로 본다 — 없는 빌드에 붙이면 재생이 시작조차 못 한다.
  const args = MusicPlayer.buildFfmpegArgs({ url: "https://x/index.m3u8" });
  const at = idx(args, "-seg_max_retry");
  if (capabilities().segMaxRetry) {
    assert.ok(at > -1, "아는 빌드에서는 붙어야 함");
    assert.ok(Number(args[at + 1]) > 0, "기본값 0이면 세그먼트 하나 실패에 스트림이 죽는다");
    assert.ok(at < idx(args, "-i"), "입력 옵션이라 -i 앞이어야 함");
  } else {
    assert.equal(at, -1, "모르는 빌드에는 붙이면 안 됨");
  }
});

test("URL 입력 + 오프셋: -ss는 -i 앞(입력측) — 재생목록은 탐색 가능하다", () => {
  const args = MusicPlayer.buildFfmpegArgs({ url: "https://x/index.m3u8", seekMs: 30000 });
  assert.ok(idx(args, "-ss") < idx(args, "-i"), args.join(" "));
  assert.equal(args[idx(args, "-ss") + 1], "30.000");
});

test("URL을 주지 않으면 갈래가 바뀌지 않는다 — 파이프가 기본이다", () => {
  for (const opts of [{}, { seekMs: 5000 }, { url: null }, { url: "" }]) {
    const args = MusicPlayer.buildFfmpegArgs(opts);
    assert.equal(args[idx(args, "-i") + 1], "pipe:0", JSON.stringify(opts));
  }
  // 파일이 있으면 파일이 이긴다 — 캐시로 트는 쪽이 언제나 낫다
  const withFile = MusicPlayer.buildFfmpegArgs({ file: "/cache/x.opus", url: "https://x/index.m3u8" });
  assert.equal(withFile[idx(withFile, "-i") + 1], "https://x/index.m3u8", "URL 갈래가 파일보다 먼저 판정된다");
});

// 아래는 길이를 전제하던 자리들. 라이브에는 길이가 없다.

const fakePlayer = (overrides = {}) => {
  const player = Object.create(MusicPlayer.prototype);
  Object.assign(player, {
    currentTrack: null,
    queue: [],
    loop: false,
    trackTimer: null,
    lastPlaybackPosition: 0,
    scheduleStatePersist() {},
    _trackLabel: () => '"x" (youtube)',
    ...overrides,
  });
  return player;
};

test("반복: 라이브가 있으면 켤 수 없고, 끄는 것은 언제나 통한다", () => {
  const playing = fakePlayer({ currentTrack: { isLive: true }, loop: false });
  assert.equal(playing.hasLiveTrack(), true);
  playing.setLoop("track");
  assert.equal(playing.loop, false, "끝이 없는 것을 반복할 수는 없다");

  const queued = fakePlayer({ currentTrack: { isLive: false }, queue: [{ isLive: false }, { isLive: true }] });
  assert.equal(queued.hasLiveTrack(), true, "대기열에 있어도 마찬가지다");
  queued.setLoop("queue");
  assert.equal(queued.loop, false);

  // 이미 걸려 있던 반복은 풀 수 있어야 한다 — 못 끄면 갇힌다
  const stuck = fakePlayer({ currentTrack: { isLive: true }, loop: "queue" });
  stuck.setLoop(false);
  assert.equal(stuck.loop, false);
});

test("반복: 라이브가 없으면 평소대로 켜진다", () => {
  const player = fakePlayer({ currentTrack: { isLive: false }, queue: [{ isLive: false }] });
  assert.equal(player.hasLiveTrack(), false);
  player.setLoop("track");
  assert.equal(player.loop, "track");
});

test("반복: 라이브가 들어오면 걸려 있던 반복을 푼다", () => {
  const player = fakePlayer({ currentTrack: { isLive: true }, loop: "queue" });
  assert.equal(player.releaseLoopForLive(), true);
  assert.equal(player.loop, false);
  assert.equal(player.releaseLoopForLive(), false, "이미 꺼져 있으면 할 일이 없다");
});

test("탐색: 라이브에는 옮길 자리가 없다 — 재생을 다시 걸지 않는다", () => {
  let played = 0;
  const player = fakePlayer({
    currentTrack: { isLive: true },
    play: () => {
      played++;
    },
  });
  const result = player.seek(30000, "seek");
  assert.equal(result.success, false);
  assert.match(result.message, /라이브/);
  assert.equal(played, 0, "play()까지 가면 안 된다");
});

test("종료 감시: 라이브는 길이로 가를 수 없어 감시를 걸지 않는다", () => {
  // duration 0인 채로 이 감시를 돌리면 "다 틀었다"로 판정해 시작하자마자 끊는다.
  let stopped = 0;
  const player = fakePlayer({
    currentTrack: { isLive: true, duration: 0, title: "라디오", platform: "youtube" },
    audioPlayer: {
      state: { status: "playing" },
      stop: () => {
        stopped++;
      },
    },
    resource: { playbackDuration: 5000 },
    currentTrackStartOffsetMs: 0,
    trackTimer: setTimeout(() => {}, 60_000),
  });
  player.ensureTrackCompletion();
  assert.equal(stopped, 0, "라이브를 정지시키면 안 된다");
  assert.equal(player.trackTimer, null, "감시를 걸어 두지도 않는다");
});

test("_reset 후에도 능력 확인이 다시 선다", () => {
  _internals._reset();
  const caps = capabilities();
  assert.equal(caps.ok, true);
});
