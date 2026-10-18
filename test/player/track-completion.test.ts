// 곡 길이가 쓰이는 곳 — 넘침 안전망(playbackWatch)의 위치 계산, 곡에 적는 오디오 길이(startPlayback)
// 가짜 플레이어로 실 오디오 없이 판정만 검증한다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Player } from "../../src/player/player.ts";
import { PlaybackWatch, type WatchHost } from "../../src/player/playback-watch.ts";
import * as tempStore from "../helpers/temp-store.ts";
import { audioDurationSec } from "../../src/player/start-playback.ts";
import { fake } from "../helpers/fake.ts";
import type { StreamInfo } from "../../src/sources/stream-url.ts";

// ── 넘침 안전망 ──────────────────────────────────────────────

// 멈춘 까닭(플레이어 안 필드)
const endReasonOf = (p: object) => (p as { _endReason?: string | null })._endReason;

function overflowPlayer({ offsetMs = 0, playedMs = 0, duration = 200, isLive = false } = {}) {
  const audio = {
    state: { status: AudioPlayerStatus.Playing },
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const player = fake<WatchHost>({
    currentTrack: { title: "곡", platform: "youtube", duration },
    playback: { startOffsetMs: offsetMs, resource: { playbackDuration: playedMs }, lengthMs: duration ? duration * 1000 : null },
    audioPlayer: audio,
    isLive,
    _endReason: null,
    _stopWith: Player.prototype._stopWith,
    _trackLabel: Player.prototype._trackLabel,
    getCurrentTime: Player.prototype.getCurrentTime,
  });
  return { player, audio, watch: new PlaybackWatch(player) };
}

test("넘침 안전망: 곡 안의 위치(시작 위치 + 낸 양)가 길이 + 30초를 넘으면 overflow 로 멈춘다", () => {
  const under = overflowPlayer({ offsetMs: 100_000, playedMs: 130_000, duration: 200 });
  under.watch.checkOverflow();
  assert.equal(under.audio.stopped, false, "230초 = 길이 + 30초. 아직 넘지 않았다");

  const over = overflowPlayer({ offsetMs: 100_000, playedMs: 130_001, duration: 200 });
  over.watch.checkOverflow();
  assert.equal(over.audio.stopped, true, "시작 위치를 빼면 넘은 줄 모른다");
  assert.equal(endReasonOf(over.player), "overflow");
});

test("넘침 안전망: 트는 음원의 길이를 모르거나 라이브면 멈추지 않는다. 표시 길이는 보지 않는다", () => {
  for (const opts of [{ duration: 0 }, { isLive: true }]) {
    const { audio, watch } = overflowPlayer({ playedMs: 10_000_000, ...opts });
    watch.checkOverflow();
    assert.equal(audio.stopped, false, JSON.stringify(opts));
  }
  const shownOnly = overflowPlayer({ playedMs: 10_000_000, duration: 200 });
  (shownOnly.player.playback as unknown as { lengthMs: number | null }).lengthMs = null;
  shownOnly.watch.checkOverflow();
  assert.equal(shownOnly.audio.stopped, false, "표시 길이만 있고 음원 길이를 모른다");
});

test("넘침 안전망: 5초마다 본다. 멈추면 더 보지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { audio, watch, player } = overflowPlayer({ playedMs: 0, duration: 200 });
  watch.startOverflow();
  (player.playback as unknown as { resource: { playbackDuration: number } }).resource.playbackDuration = 231_000;
  t.mock.timers.tick(4_999);
  assert.equal(audio.stopped, false);
  t.mock.timers.tick(1);
  assert.equal(audio.stopped, true);
  assert.equal(watch.overflowTimer, null);
});

// ── 판정용 오디오 길이 ───────────────────────────────────────
// 재생목록으로 담은 스포티파이 곡은 스포티파이 길이를 들고 오는데, 실제 오디오는 수 초 짧을 수 있다.
// 그 차이로 멀쩡한 종료가 조기 종료로 판정되고 SponsorBlock 곡 끝 구간이 파일 끝으로 건너뛰기가 됐다.

// 캐시 기록은 임시 DB 에 적었다가 삭제한다
const store = tempStore.openTempStore("track-completion-");
after(() => store.close());

function withLookup<T>(rows: Record<string, { duration_sec: number }>, fn: () => T) {
  const insert = store.db().prepare("INSERT INTO audio_cache (audio_key, status, duration_sec) VALUES (?, 'cached', ?)");
  for (const [key, row] of Object.entries(rows)) insert.run(key, row.duration_sec);
  try {
    return fn();
  } finally {
    store.db().prepare("DELETE FROM audio_cache").run();
  }
}

const track = () => ({ duration: 314, audioUrl: "https://www.youtube.com/watch?v=x" });

test("캐시 파일로 틀면 캐시에 기록된 오디오 길이를 쓴다", () => {
  withLookup({ "yt:x": { duration_sec: 312 } }, () => {
    assert.equal(audioDurationSec(track(), null, "/cache/x.opus"), 312);
  });
});

test("캐시 파일로 틀 때는 스트림 정보보다 캐시 기록이 우선이다 (틀고 있는 게 그 파일이다)", () => {
  withLookup({ "yt:x": { duration_sec: 312 } }, () => {
    assert.equal(audioDurationSec(track(), { duration: 999 }, "/cache/x.opus"), 312);
  });
});

test("스트림으로 틀면 스트림 정보의 길이를 쓴다", () => {
  withLookup({}, () => {
    assert.equal(audioDurationSec(track(), { duration: 312 }, null), 312);
  });
});

test("둘 다 모르면 null — 곡의 기존 길이를 건드리지 않는다", () => {
  withLookup({}, () => {
    assert.equal(audioDurationSec(track(), null, "/cache/x.opus"), null);
    const lengthless: StreamInfo = { url: "https://example.com/stream-url" };
    assert.equal(audioDurationSec(track(), lengthless, null), null, "길이 없는 스트림 정보");
  });
});
