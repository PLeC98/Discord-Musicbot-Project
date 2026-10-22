// src/player/playback-watch.ts 버퍼링 감시 — 재생이 시작되지 않은 채 멈춘 곡을 깨우는 판정
// 가짜 플레이어로 실 오디오 없이 판정만 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Player } from "../../src/player/player.ts";
import { PlaybackWatch, type WatchHost } from "../../src/player/playback-watch.ts";
import { fake } from "../helpers/fake.ts";

type Options = { status?: AudioPlayerStatus; inputAt?: number | null; reason?: string | null; since?: number };

// 멈춘 까닭(플레이어 안 필드)
const endReasonOf = (p: object) => (p as { _endReason?: string | null })._endReason;

function fakePlayer({ status = AudioPlayerStatus.Buffering, inputAt = null, reason = null }: Options = {}) {
  const stops: Array<boolean | undefined> = [];
  const player = fake<WatchHost>({
    currentTrack: { title: "곡", platform: "youtube" },
    audioPlayer: {
      state: { status },
      stop(force?: boolean) {
        stops.push(force);
      },
    },
    _endReason: reason,
    _stopWith: Player.prototype._stopWith,
    _clearSilentStop: Player.prototype._clearSilentStop,
    _silentStop: null,
    playback: { inputProgressAt: inputAt },
    _trackLabel: Player.prototype._trackLabel,
  });
  return { player, stops };
}

// 감시를 세우고 버퍼링이 언제 시작됐는지 적는다
function watching(opts: Options = {}) {
  const { player, stops } = fakePlayer(opts);
  const watch = new PlaybackWatch(player);
  watch.bufferingSince = opts.since ?? 0;
  return { player, stops, watch };
}

test("입력 없이 15초 버퍼링이면 강제로 멈춰 복구 경로로 보낸다", () => {
  const { player, stops, watch } = watching({ since: 0 });
  watch.checkBufferingStall(14_999);
  assert.deepEqual(stops, [], "아직 이르다");
  watch.checkBufferingStall(15_000);
  assert.deepEqual(stops, [true], "force 없이는 Buffering에서 Idle로 가지 않는다");
  assert.equal(endReasonOf(player), "buffering-stall");
});

test("입력이 들어오고 있으면 버퍼링이 길어도 멈추지 않는다", () => {
  const { stops, watch } = watching({ since: 0, inputAt: 10_000 });
  watch.checkBufferingStall(20_000);
  assert.deepEqual(stops, []);
  watch.checkBufferingStall(25_000);
  assert.deepEqual(stops, [true], "마지막 입력 뒤 15초");
});

test("이미 버퍼링이 아니면 아무것도 하지 않는다", () => {
  const { stops, watch } = watching({ status: AudioPlayerStatus.Playing, since: 0 });
  watch.checkBufferingStall(60_000);
  assert.deepEqual(stops, []);
});

test("이미 정해진 종료 사유는 덮지 않는다", () => {
  const { player, watch } = watching({ since: 0, reason: "skip" });
  watch.checkBufferingStall(15_000);
  assert.equal(endReasonOf(player), "skip");
});
