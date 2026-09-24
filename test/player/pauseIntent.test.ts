// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// src/player/Player.ts — 일시정지 의도가 버퍼링을 넘어 살아남는가.
// @discordjs/voice의 pause()는 재생 중일 때만 받는다. play(resource) 직후는 버퍼링이라, 그때 건 일시정지가
// 조용히 무시되고 곡이 재생됐다(재시작 복원에서 재현).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MusicPlayer } from "../../src/player/Player.ts";

// @discordjs/voice와 같은 규칙: 상태가 바뀌면 그 상태 이름으로 이벤트, pause()는 playing에서만, unpause()는 paused에서만
function fakeAudioPlayer(status) {
  const ap = new EventEmitter();
  ap.state = { status };
  ap.to = (next) => {
    const old = ap.state;
    ap.state = { status: next };
    ap.emit(next, old, ap.state);
  };
  ap.pause = () => {
    if (ap.state.status !== "playing") return false;
    ap.to("paused");
    return true;
  };
  ap.unpause = () => {
    if (ap.state.status !== "paused") return false;
    ap.to("playing");
    return true;
  };
  return ap;
}

function makePlayer(status) {
  const p = {
    audioPlayer: fakeAudioPlayer(status),
    pauseReasons: new Set(),
    paused: false,
    currentTrack: null,
    voice: { startConnectionHealthCheck() {}, setupConnectionEvents() {} },
    scheduleStatePersist() {},
    onPlayerIdle() {},
    _trackLabel: MusicPlayer.prototype._trackLabel,
    pauseFor: MusicPlayer.prototype.pauseFor,
    resumeFor: MusicPlayer.prototype.resumeFor,
  };
  MusicPlayer.prototype.setupEvents.call(p);
  return p;
}

test("버퍼링 중에 건 일시정지는 재생으로 넘어오는 순간 걸린다 — 재시작 복원 회귀", () => {
  const p = makePlayer("buffering");
  assert.equal(p.pauseFor("manual"), true, "의도는 받았다고 알린다 — 일시정지 버튼이 이 값으로 응답한다");
  assert.equal(p.paused, true);

  p.audioPlayer.to("playing");
  assert.equal(p.audioPlayer.state.status, "paused", "구 코드는 여기서 그대로 재생됐다");
  assert.equal(p.paused, true);
});

test("버퍼링 중에 풀었으면 그대로 재생한다", () => {
  const p = makePlayer("buffering");
  p.pauseFor("manual");
  assert.equal(p.resumeFor("manual"), true);
  assert.equal(p.paused, false);

  p.audioPlayer.to("playing");
  assert.equal(p.audioPlayer.state.status, "playing");
});

test("사유가 하나라도 남아 있으면 계속 멈춘다", () => {
  const p = makePlayer("buffering");
  p.pauseFor("manual");
  p.pauseFor("alone");
  assert.equal(p.resumeFor("alone"), false);

  p.audioPlayer.to("playing");
  assert.equal(p.audioPlayer.state.status, "paused");
});

test("멈춘 채 새 곡이 시작돼도(이동·다음 곡) 멈춘 상태를 지킨다", () => {
  const p = makePlayer("idle");
  p.pauseReasons.add("manual");
  p.audioPlayer.to("buffering");
  p.audioPlayer.to("playing");
  assert.equal(p.audioPlayer.state.status, "paused");
});

test("사유 없는 재생은 건드리지 않는다", () => {
  const p = makePlayer("buffering");
  assert.equal(p.pauseFor(), false, "사유 없이 부르면 받아 둘 의도가 없다");

  p.audioPlayer.to("playing");
  assert.equal(p.audioPlayer.state.status, "playing");
  assert.equal(p.paused, false);
});
