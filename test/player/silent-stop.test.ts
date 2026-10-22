// src/player/player.ts 의 _stopWith — 재생 중이면 묵음 프레임 다섯을 보낸 뒤 멈추고(stop()), 그 밖이면 바로 멈춘다(stop(true)).
// 묵음을 흘려보내는 동안은 멈추는 중이고, 상한이 지나도 Idle 이 아니면 바로 멈춘다. 대시보드는 그동안도 곡이 바뀌기를 기다린다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Player } from "../../src/player/player.ts";
import { fake } from "../helpers/fake.ts";

function fakePlayer(status: AudioPlayerStatus) {
  const stops: Array<boolean | undefined> = [];
  const player = fake<Player>({
    currentTrack: { title: "곡", platform: "youtube" },
    audioPlayer: {
      state: { status },
      stop(force?: boolean) {
        stops.push(force);
      },
    },
    _endReason: null,
    _endScheduled: false,
    _endWaiters: new Set(),
    _silentStop: null,
    lifecycle: { ending: false },
    _stopWith: Player.prototype._stopWith,
    _clearSilentStop: Player.prototype._clearSilentStop,
    _trackLabel: Player.prototype._trackLabel,
    untilSwitched: Player.prototype.untilSwitched,
    _scheduleEnd() {},
  });
  Object.defineProperty(player, "isStopping", Object.getOwnPropertyDescriptor(Player.prototype, "isStopping")!);
  return { player, stops };
}

test("재생 중이면 묵음을 흘려보내며 멈추고, Idle 이 오면 멈추는 중이 끝난다", () => {
  const { player, stops } = fakePlayer(AudioPlayerStatus.Playing);
  player._stopWith("skip");
  assert.deepEqual(stops, [undefined], "강제 없이");
  assert.equal(player.isStopping, true);
  assert.equal(player._endReason, "skip");

  player._stopWith("jump");
  assert.deepEqual(stops, [undefined], "멈추는 중에 다시 멈추지 않는다");
  assert.equal(player._endReason, "skip", "먼저 온 까닭을 지킨다");

  Player.prototype.onPlayerIdle.call(player);
  assert.equal(player.isStopping, false);
});

test("버퍼링 · 일시정지 중이거나 force 면 바로 멈춘다(묵음은 재생 중에만 흘러간다)", () => {
  for (const status of [AudioPlayerStatus.Buffering, AudioPlayerStatus.Paused, AudioPlayerStatus.AutoPaused]) {
    const { player, stops } = fakePlayer(status);
    player._stopWith("skip");
    assert.deepEqual(stops, [true], status);
    assert.equal(player.isStopping, false);
  }
  const { player, stops } = fakePlayer(AudioPlayerStatus.Playing);
  player._stopWith("dispose", { force: true });
  assert.deepEqual(stops, [true]);
});

test("묵음 멈춤이 상한 안에 Idle 에 닿지 못하면(그새 일시정지 등) 바로 멈춘다", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player, stops } = fakePlayer(AudioPlayerStatus.Playing);
  player._stopWith("skip");
  (player.audioPlayer.state as { status: AudioPlayerStatus }).status = AudioPlayerStatus.Paused;
  t.mock.timers.tick(499);
  assert.deepEqual(stops, [undefined]);
  t.mock.timers.tick(1);
  assert.deepEqual(stops, [undefined, true]);
  assert.equal(player.isStopping, false);
});

test("대시보드는 묵음을 흘려보내는 동안에도 곡이 바뀌기를 기다린다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { player } = fakePlayer(AudioPlayerStatus.Playing);
  player._stopWith("skip");
  let switched = false;
  void player.untilSwitched().then(() => (switched = true));
  await Promise.resolve();
  assert.equal(switched, false, "Idle 전이라도 곧바로 돌아오지 않는다");
  for (const wake of [...player._endWaiters]) wake();
  await Promise.resolve();
  assert.equal(switched, true);
});
