"use strict";

// 곡 길이 판정 — 종료 감시(playbackWatch)의 위치 계산, 판정에 쓰는 오디오 길이 선택(Player)
// 가짜 플레이어로 실 오디오 없이 판정만 검증한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AudioPlayerStatus } = require("@discordjs/voice");
const MusicPlayer = require("../../src/player/Player");
const PlaybackWatch = require("../../src/player/playbackWatch");
const audioCache = require("../../src/store/audioCache");

// ── 종료 워치독 ──────────────────────────────────────────────

function watchdogPlayer({ offsetMs = 0, playedMs = 0, duration = 200 } = {}) {
  return {
    currentTrack: { title: "곡", platform: "spotify", duration },
    playback: { startOffsetMs: offsetMs, resource: { playbackDuration: playedMs } },
    audioPlayer: {
      state: { status: AudioPlayerStatus.Playing },
      stopped: false,
      stop() {
        this.stopped = true;
      },
    },
    pendingEndReason: null,
    _trackLabel: MusicPlayer.prototype._trackLabel,
    getCurrentTime: MusicPlayer.prototype.getCurrentTime,
  };
}
const watchOf = (p) => (p.watch ??= new PlaybackWatch(p));

test("종료 워치독은 시작 오프셋을 더해 곡 안의 위치로 판정한다", () => {
  // 100초 지점부터 틀어 100초를 냈다 = 200초 곡의 끝
  const p = watchdogPlayer({ offsetMs: 100_000, playedMs: 100_000, duration: 200 });
  watchOf(p).checkEnd();
  assert.equal(p.audioPlayer.stopped, true, "오프셋을 빼면 100초 남은 줄 알고 미룬다");
  assert.equal(p.pendingEndReason, "watchdog");
});

test("아직 남았으면 멈추지 않고 다시 확인한다", () => {
  const p = watchdogPlayer({ offsetMs: 0, playedMs: 100_000, duration: 200 });
  watchOf(p).checkEnd();
  assert.equal(p.audioPlayer.stopped, false);
  assert.ok(p.watch.endTimer);
  p.watch.stop();
});

// ── 판정용 오디오 길이 ───────────────────────────────────────
// 재생목록으로 담은 스포티파이 곡은 스포티파이 길이를 들고 오는데, 실제 오디오는 수 초 짧을 수 있다.
// 그 차이로 멀쩡한 종료가 조기 종료로 판정되고 SponsorBlock 곡 끝 구간이 파일 끝으로 건너뛰기가 됐다.

const audioDuration = MusicPlayer.prototype._audioDurationSec;

function withLookup(rows, fn) {
  const original = audioCache.lookupByAudioKey;
  audioCache.lookupByAudioKey = (key) => rows[key] || null;
  try {
    return fn();
  } finally {
    audioCache.lookupByAudioKey = original;
  }
}

const track = () => ({ duration: 314, audioUrl: "https://www.youtube.com/watch?v=x" });

test("캐시 파일로 틀면 캐시에 기록된 오디오 길이를 쓴다", () => {
  withLookup({ "yt:x": { duration_sec: 312 } }, () => {
    assert.equal(audioDuration.call({ currentTrack: track() }, null, "/cache/x.opus"), 312);
  });
});

test("캐시 파일로 틀 때는 스트림 정보보다 캐시 기록이 우선이다 (틀고 있는 게 그 파일이다)", () => {
  withLookup({ "yt:x": { duration_sec: 312 } }, () => {
    assert.equal(audioDuration.call({ currentTrack: track() }, { duration: 999 }, "/cache/x.opus"), 312);
  });
});

test("스트림으로 틀면 스트림 정보의 길이를 쓴다", () => {
  withLookup({}, () => {
    assert.equal(audioDuration.call({ currentTrack: track() }, { duration: 312 }, null), 312);
  });
});

test("둘 다 모르면 null — 곡의 기존 길이를 건드리지 않는다", () => {
  withLookup({}, () => {
    const p = { currentTrack: track() };
    assert.equal(audioDuration.call(p, null, "/cache/x.opus"), null);
    assert.equal(audioDuration.call(p, "https://example.com/stream-url", null), null, "문자열 스트림 정보에는 길이가 없다");
  });
});
