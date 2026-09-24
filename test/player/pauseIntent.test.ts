// src/player/Player.ts — 일시정지 의도가 버퍼링을 넘어 살아남는가.
// @discordjs/voice의 pause()는 재생 중일 때만 받는다. play(resource) 직후는 버퍼링이라, 그때 건 일시정지가
// 조용히 무시되고 곡이 재생됐다(재시작 복원에서 재현).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MusicPlayer } from "../../src/player/Player.ts";
import { fakePlayer } from "../helpers/fake.ts";

// @discordjs/voice와 같은 규칙: 상태가 바뀌면 그 상태 이름으로 이벤트, pause()는 playing에서만, unpause()는 paused에서만
class FakeAudio extends EventEmitter {
  state: { status: string };

  constructor(status: string) {
    super();
    this.state = { status };
  }

  to(next: string) {
    const old = this.state;
    this.state = { status: next };
    this.emit(next, old, this.state);
  }

  pause() {
    if (this.state.status !== "playing") return false;
    this.to("paused");
    return true;
  }

  unpause() {
    if (this.state.status !== "paused") return false;
    this.to("playing");
    return true;
  }
}

function makePlayer(status: string) {
  const audio = new FakeAudio(status);
  const p = fakePlayer({
    audioPlayer: audio,
    pauseReasons: new Set(),
    paused: false,
    currentTrack: null,
    voice: { startConnectionHealthCheck() {}, setupConnectionEvents() {} },
    scheduleStatePersist() {},
    onPlayerIdle() {},
    _trackLabel: MusicPlayer.prototype._trackLabel,
    pauseFor: MusicPlayer.prototype.pauseFor,
    resumeFor: MusicPlayer.prototype.resumeFor,
  });
  MusicPlayer.prototype.setupEvents.call(p);
  // 가짜 오디오 플레이어의 상태를 옮기는 손잡이
  return Object.assign(p, { audio });
}

test("버퍼링 중에 건 일시정지는 재생으로 넘어오는 순간 걸린다 — 재시작 복원 회귀", () => {
  const p = makePlayer("buffering");
  assert.equal(p.pauseFor("manual"), true, "의도는 받았다고 알린다 — 일시정지 버튼이 이 값으로 응답한다");
  assert.equal(p.paused, true);

  p.audio.to("playing");
  assert.equal(p.audio.state.status, "paused", "구 코드는 여기서 그대로 재생됐다");
  assert.equal(p.paused, true);
});

test("버퍼링 중에 풀었으면 그대로 재생한다", () => {
  const p = makePlayer("buffering");
  p.pauseFor("manual");
  assert.equal(p.resumeFor("manual"), true);
  assert.equal(p.paused, false);

  p.audio.to("playing");
  assert.equal(p.audio.state.status, "playing");
});

test("사유가 하나라도 남아 있으면 계속 멈춘다", () => {
  const p = makePlayer("buffering");
  p.pauseFor("manual");
  p.pauseFor("alone");
  assert.equal(p.resumeFor("alone"), false);

  p.audio.to("playing");
  assert.equal(p.audio.state.status, "paused");
});

test("멈춘 채 새 곡이 시작돼도(이동·다음 곡) 멈춘 상태를 지킨다", () => {
  const p = makePlayer("idle");
  p.pauseReasons.add("manual");
  p.audio.to("buffering");
  p.audio.to("playing");
  assert.equal(p.audio.state.status, "paused");
});

test("사유 없는 재생은 건드리지 않는다", () => {
  const p = makePlayer("buffering");
  assert.equal(p.pauseFor(), false, "사유 없이 부르면 받아 둘 의도가 없다");

  p.audio.to("playing");
  assert.equal(p.audio.state.status, "playing");
  assert.equal(p.paused, false);
});
