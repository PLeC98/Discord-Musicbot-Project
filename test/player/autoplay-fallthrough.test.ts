// src/player/player.ts — 자동재생이 곡을 선택하지 못한 뒤의 상태.
//
// 후보를 하나도 못 찾아도 대기열 소진 처리(현재곡 비우기 · 종료 패널 · 퇴장 예약)를 건너뛰지 않는다.
// 건너뛰면 currentTrack 이 끝난 곡을 가리킨 채 남아 패널이 멈추고, 곡을 넣어도 대기열에만 쌓인다.
// 키워드 검색이 한 시간짜리 믹스만 돌려주면 후보가 0 이 된다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../../src/player/player.ts";
import { PlaybackState } from "../../src/player/playback-state.ts";

const onTrackEnd = Player.prototype.onTrackEnd;

import { fakePlayer } from "../helpers/fake.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";

useDefaultDocuments();

function makeTrack(title: string, duration = 100) {
  return { title, url: `https://y/${title}`, duration };
}

// 대기열 소진 꼬리까지 받아 내는 하네스 — playbackLoop의 것은 반복 전이용이라 여기까지 오지 않는다.
function makePlayer({ autoplay = false, current = makeTrack("A"), picked = false }: { autoplay?: string | false; current?: ReturnType<typeof makeTrack> | null; picked?: boolean } = {}) {
  const calls = { idleLeave: 0, playbackEnd: [] as string[], autoplay: 0, voiceStatus: 0 };
  return fakePlayer({
    calls,
    lifecycle: new PlaybackState(),
    watch: { stopOverflow() {}, stopBuffering() {}, stop() {}, startOverflow() {}, startBuffering() {} },
    currentTrack: current,
    playback: current ? { resource: { playbackDuration: (current.duration || 0) * 1000 } } : null,
    lastPlaybackPosition: 0,
    retry: { used: 0, stalled: 0 },
    failedTracks: 0,
    failedLabels: [],
    _laterEnd: null,
    _runLaterEnd: Player.prototype._runLaterEnd,
    _scheduleEnd: Player.prototype._scheduleEnd,
    _closeEnd: Player.prototype._closeEnd,
    _endScheduled: false,
    _endWaiters: new Set(),
    _resetFailures: Player.prototype._resetFailures,
    previousTracks: [],
    loop: false,
    queue: [],
    autoplay,
    _endReason: null,
    _stopWith: Player.prototype._stopWith,
    textChannel: null,
    persistence: { removeSession() {} },
    guild: { id: "g1", client: {} },
    _trackLabel: Player.prototype._trackLabel,
    getCurrentTime: Player.prototype.getCurrentTime,
    _describeEnd: Player.prototype._describeEnd,
    _recoverDrop: Player.prototype._recoverDrop,
    _countFailure: Player.prototype._countFailure,
    _playNext: Player.prototype._playNext,
    _continueAutoplay: Player.prototype._continueAutoplay,
    finishQueue: Player.prototype.finishQueue,
    audioPlayer: { stop() {} },
    releaseAudioProtection() {},
    scheduleStatePersist() {},
    async updateVoiceStatus() {
      calls.voiceStatus++;
    },
    idle: {
      cancelAlone() {},
      cancelEmpty() {},
      scheduleEmpty() {
        calls.idleLeave++;
      },
    },
    async handleAutoplay() {
      calls.autoplay++;
      if (!picked) return false;
      this.currentTrack = makeTrack("자동재생곡");
      return true;
    },
    async play() {},
  });
}

test("자동재생이 곡을 선택하지 못하면 대기열 소진 흐름으로 떨어진다", async () => {
  const p = makePlayer({ autoplay: "lo-fi", picked: false });

  await onTrackEnd.call(p, "idle");

  assert.equal(p.calls.autoplay, 1, "자동재생을 시도는 한다");
  assert.equal(p.currentTrack, null, "끝난 곡을 들고 있으면 패널 · 대기열이 멈춘다");
  assert.equal(p.calls.idleLeave, 1, "퇴장 예약까지 정상 종료 경로를 탄다");
  assert.equal(p.calls.voiceStatus, 1);
  assert.equal(p.autoplay, "lo-fi", "한 번 못 찾았다고 장르를 꺼버리면 안 된다 — 다음 곡에서 다시 시도한다");
});

test("자동재생이 곡을 선택하면 종료 흐름을 타지 않는다", async () => {
  const p = makePlayer({ autoplay: "pop", picked: true });

  await onTrackEnd.call(p, "idle");

  assert.equal(p.calls.autoplay, 1);
  assert.equal(p.currentTrack?.title, "자동재생곡");
  assert.equal(p.calls.idleLeave, 0, "다음 곡을 틀었으니 퇴장을 예약하면 안 된다");
});

test("자동재생이 꺼져 있으면 종전대로 대기열 소진", async () => {
  const p = makePlayer({ autoplay: false });

  await onTrackEnd.call(p, "idle");

  assert.equal(p.calls.autoplay, 0);
  assert.equal(p.currentTrack, null);
  assert.equal(p.calls.idleLeave, 1);
});
