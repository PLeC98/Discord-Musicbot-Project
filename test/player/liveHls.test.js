"use strict";

// 라이브(HLS) 재생 경로의 불변식.
//
// HLS는 "받아 둔 바이트"가 아니라 "받아 올 주소"를 줘야 열리는 형식이라, 이 갈래만 ffmpeg에
// URL을 넘긴다. 나머지 스트리밍이 그 길로 새면 httpHeaders가 빠지고 폴백을 건너뛴다.
// 그리고 라이브에는 길이가 없어서, 길이를 전제하던 자리들(종료 감시·탐색·반복)이 전부 걸린다.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const MusicPlayer = require("../../src/player/Player");
const PlaybackState = require("../../src/player/playbackState");
const PlaybackWatch = require("../../src/player/playbackWatch");
const YouTube = require("../../src/sources/youtube/index");
const MusicEmbedManager = require("../../src/ui/nowPlayingPanel");
const { capabilities, _internals } = require("../../src/media/ffmpeg/path");

const idx = (args, flag) => args.indexOf(flag);

test("능력 확인: 우리가 깔아 주는 빌드는 https와 hls를 갖췄다", () => {
  const caps = capabilities();
  assert.equal(caps.https, true, "https 프로토콜이 있어야 라이브 주소를 연다");
  assert.equal(caps.hls, true, "hls 디먹서가 있어야 재생목록을 읽는다");
  assert.equal(caps.ok, true);
  assert.equal(typeof caps.segMaxRetry, "boolean", "세그먼트 재시도 옵션은 있고 없고를 가린다");
});

test("능력 확인 결과는 캐시된다. 재생할 때마다 프로세스를 띄우지 않는다", () => {
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
  // 다만 live_status가 명시됐다면 그쪽이 정본이다. was_live인데 is_live가 남아 오는 경우.
  assert.equal(YouTube.liveStatusOf({ live_status: "was_live", is_live: true }), null);
});

test("titleOf: 라이브 제목에 붙는 조회 시각을 떼어 낸다", () => {
  // yt-dlp는 라이브의 `title` 뒤에 조회 시각을 붙인다. 그대로 쓰면 대기열·패널·로그에
  // "... 2026-09-21 02:58" 이 따라다니고, 새로 조회할 때마다 제목이 달라진다.
  const live = { live_status: "is_live", title: "lofi radio 2026-09-21 02:26", fulltitle: "lofi radio" };
  assert.equal(YouTube.titleOf(live), "lofi radio");

  // 라이브가 아니면 둘이 같다. 건드릴 것이 없다
  assert.equal(YouTube.titleOf({ title: "보통곡", fulltitle: "보통곡" }), "보통곡");
  assert.equal(YouTube.titleOf({ title: "fulltitle 없음" }), "fulltitle 없음");
  // fulltitle이 비어 오면 title로 돌아간다
  assert.equal(YouTube.titleOf({ live_status: "is_live", title: "A", fulltitle: "   " }), "A");
  assert.equal(YouTube.titleOf({}), null);
  assert.equal(YouTube.titleOf(null), null);
});

test("진행바: 라이브는 경과 시간 자리에 표식을 넣고 길이를 비운다", () => {
  const manager = Object.create(MusicEmbedManager.prototype);
  manager.formatDuration = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  const live = manager.buildProgressBar(65, 0, { live: true });
  assert.match(live, /LIVE/, "라이브임을 알려야 한다");
  assert.doesNotMatch(live, /1:05/, "붙어 있은 시간은 곡 안의 위치가 아니다");
  assert.doesNotMatch(live, /●/, "찍을 지점이 없다");
  assert.ok(live.includes("-:--"), "길이는 모른다");

  // 보통 곡은 그대로다
  const normal = manager.buildProgressBar(65, 200);
  assert.match(normal, /1:05/);
  assert.match(normal, /3:20/);
  assert.match(normal, /●/);
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
  // ffmpeg는 모르는 옵션을 치명적 오류로 본다. 없는 빌드에 붙이면 재생이 시작조차 못 한다.
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

test("URL 입력 + 오프셋: -ss는 -i 앞(입력측). 재생목록은 탐색 가능하다", () => {
  const args = MusicPlayer.buildFfmpegArgs({ url: "https://x/index.m3u8", seekMs: 30000 });
  assert.ok(idx(args, "-ss") < idx(args, "-i"), args.join(" "));
  assert.equal(args[idx(args, "-ss") + 1], "30.000");
});

test("URL을 주지 않으면 갈래가 바뀌지 않는다. 파이프가 기본이다", () => {
  for (const opts of [{}, { seekMs: 5000 }, { url: null }, { url: "" }]) {
    const args = MusicPlayer.buildFfmpegArgs(opts);
    assert.equal(args[idx(args, "-i") + 1], "pipe:0", JSON.stringify(opts));
  }
  // 둘을 같이 주면 URL이 이긴다. 다만 "캐시가 있으면 캐시로 튼다"를 정하는 것은 여기가 아니라
  // _play 쪽이다(파일이 잡혀 있으면 URL 갈래를 아예 타지 않는다).
  const withFile = MusicPlayer.buildFfmpegArgs({ file: "/cache/x.opus", url: "https://x/index.m3u8" });
  assert.equal(withFile[idx(withFile, "-i") + 1], "https://x/index.m3u8");
});

// 아래는 길이를 전제하던 자리들. 라이브에는 길이가 없다.

const fakePlayer = (overrides = {}) => {
  const player = Object.create(MusicPlayer.prototype);
  Object.assign(player, {
    currentTrack: null,
    queue: [],
    loop: false,
    lastPlaybackPosition: 0,
    scheduleStatePersist() {},
    _trackLabel: () => '"x" (youtube)',
    ...overrides,
  });
  player.watch = new PlaybackWatch(player);
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

  // 이미 걸려 있던 반복은 풀 수 있어야 한다. 못 끄면 갇힌다
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

test("탐색: 라이브에는 옮길 자리가 없다. 재생을 다시 걸지 않는다", () => {
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
  });
  player.watch.endTimer = setTimeout(() => {}, 60_000).unref(); // 걸려 있던 감시. 프로세스를 붙잡지 않게
  player.watch.checkEnd();
  assert.equal(stopped, 0, "라이브를 정지시키면 안 된다");
  assert.equal(player.watch.endTimer, null, "감시를 걸어 두지도 않는다");
});

test("종료 감시 예약: 라이브에는 5분 폴백 워치독을 걸지 않는다", () => {
  // 길이를 모르는 스트림은 5분 뒤 강제 종료가 기본값이다. 그대로 두면 방송이 5분마다 잘린다.
  const live = fakePlayer({ currentTrack: { isLive: true, duration: 0, title: "라디오", platform: "youtube" } });
  live.watch.scheduleEnd({});
  assert.equal(live.watch.endTimer, null);

  // 라이브가 아니면 평소대로 걸린다
  const normal = fakePlayer({ currentTrack: { isLive: false, duration: 200, title: "곡", platform: "youtube" }, currentTrackStartOffsetMs: 0 });
  normal.watch.scheduleEnd({ duration: 200 });
  assert.notEqual(normal.watch.endTimer, null);
  normal.watch.stop();
});

test("_reset 후에도 능력 확인이 다시 선다", () => {
  _internals._reset();
  const caps = capabilities();
  assert.equal(caps.ok, true);
});

// 라이브가 끊겼을 때 무엇을 하는가. 길이가 없어 "일찍 끝났다"로 가를 수 없으므로 ffmpeg의
// 종료 코드로 가른다. 0이면 방송이 끝난 것, 그 밖은 사고다.

const endingPlayer = (overrides = {}) => {
  const played = [];
  const player = fakePlayer({
    lifecycle: new PlaybackState(),
    sponsorSkipper: { stop() {} },
    previousTracks: [],
    currentDownloadedFile: null,
    autoplay: false,
    resource: { playbackDuration: 30_000 },
    currentTrackStartOffsetMs: 0,
    releaseAudioProtection() {},
    play: async (track, ms) => {
      played.push(ms);
      return { success: true };
    },
    ...overrides,
  });
  player.played = played;
  return player;
};

test("라이브 종료: ffmpeg가 0으로 끝나면 방송이 끝난 것이니 다음 곡으로", async () => {
  const finished = { title: "라디오", isLive: true };
  const next = { title: "다음곡" };
  const player = endingPlayer({ currentTrack: finished, queue: [next], _playingLive: true, _liveExitCode: 0 });

  await player.handleTrackEnd("idle");

  assert.equal(player.currentTrack, next, "다음 곡으로 넘어가야 함");
  assert.deepEqual(player.played, [0]);
  assert.deepEqual(player.previousTracks, [finished]);
});

test("라이브 종료: 사고로 끊기면 같은 곡을 위치 0으로 다시 연다", async () => {
  // 위치 0으로 트는 것이 곧 "yt-dlp로 주소를 새로 받는다"다. 만료된 주소로는 몇 번을 붙어도 실패한다.
  const finished = { title: "라디오", isLive: true };
  const next = { title: "다음곡" };
  const player = endingPlayer({ currentTrack: finished, queue: [next], _playingLive: true, _liveExitCode: 1 });

  await player.handleTrackEnd("idle");

  assert.equal(player.currentTrack, finished, "같은 방송을 계속 튼다");
  assert.deepEqual(player.played, [0], "끊긴 위치가 아니라 라이브 엣지로 붙는다");
  assert.deepEqual(player.queue, [next], "대기열은 그대로");
});

test("라이브 종료: 사용자가 스킵한 것은 사고가 아니다", async () => {
  const finished = { title: "라디오", isLive: true };
  const next = { title: "다음곡" };
  const player = endingPlayer({ currentTrack: finished, queue: [next], _playingLive: true, _liveExitCode: -1 });

  await player.handleTrackEnd("skip");

  assert.equal(player.currentTrack, next);
});

test("라이브 종료: 재시도를 다 쓰면 다음 곡으로 넘긴다", async () => {
  const finished = { title: "라디오", isLive: true };
  const next = { title: "다음곡" };
  const player = endingPlayer({ currentTrack: finished, queue: [next], _playingLive: true, _liveExitCode: 1 });
  // 이미 상한까지 다시 열어 본 상태로 둔다. 상한을 넘기면 포기해야 한다
  player._retryTrack = finished;
  player.currentTrackRetries = 99;

  await player.handleTrackEnd("idle");

  assert.equal(player.currentTrack, next);
  assert.deepEqual(player.played, [0]);
});

test("끝난 방송(was_live)은 재연결 대상이 아니다. 라이브 갈래를 타지 않았다", async () => {
  // 대기열에 담길 때는 방송 중이었지만 재생 시점에는 다시보기였다. 길이가 있으니 평범한 곡이다.
  // 이때 재연결로 들어가면 정상 종료마다 몇 초씩 멈춘 뒤에야 다음 곡으로 넘어간다.
  const finished = { title: "끝난 방송", isLive: true, duration: 3600 };
  const next = { title: "다음곡" };
  const player = endingPlayer({
    currentTrack: finished,
    queue: [next],
    _playingLive: false,
    _liveExitCode: 1,
    resource: { playbackDuration: 3_600_000 },
  });

  await player.handleTrackEnd("idle");

  assert.equal(player.currentTrack, next);
  assert.deepEqual(player.played, [0]);
});
