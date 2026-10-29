// src/player/pause-state.ts — 사람의 뜻과 억제 사유를 따로 들고, 오디오를 한 곳에서 맞춘다

import { test } from "node:test";
import assert from "node:assert/strict";
import { PauseState, type PauseChange } from "../../src/player/pause-state.ts";

// @discordjs/voice 와 같은 규칙: pause() 는 playing 에서만, unpause() 는 paused 에서만
function audio(status: string) {
  const a = {
    state: { status },
    pause: () => (a.state.status === "playing" ? ((a.state = { status: "paused" }), true) : false),
    unpause: () => (a.state.status === "paused" ? ((a.state = { status: "playing" }), true) : false),
  };
  return a;
}

function make(status = "playing") {
  const a = audio(status);
  const seen: PauseChange[] = [];
  const state = new PauseState(
    () => a as never,
    (change) => seen.push(change),
  );
  return { a, seen, state };
}

test("사람이 멈추고 풀면 오디오가 따르고, 바뀐 때만 알린다", () => {
  const { a, seen, state } = make();
  state.setUser(true);
  assert.equal(a.state.status, "paused");
  assert.equal(state.silent, true);
  state.setUser(true);
  assert.equal(seen.length, 1, "같은 값은 알리지 않는다");
  state.setUser(false);
  assert.equal(a.state.status, "playing");
  assert.deepEqual(seen, [
    { user: true, added: [], removed: [] },
    { user: false, added: [], removed: [] },
  ]);
});

test("억제 사유는 통째로 맞추고 더해진 것 · 빠진 것을 알린다", () => {
  const { a, seen, state } = make();
  assert.deepEqual(state.setHolds(["mute", "alone"]), { added: ["mute", "alone"], removed: [] });
  assert.equal(a.state.status, "paused");
  assert.equal(state.heldBy, "mute");
  assert.deepEqual(state.setHolds(["alone"]), { added: [], removed: ["mute"] });
  assert.deepEqual(state.setHolds(["alone"]), { added: [], removed: [] });
  assert.equal(seen.length, 2, "그대로면 알리지 않는다");
  state.setHolds([]);
  assert.equal(a.state.status, "playing");
});

test("사람이 멈춰 둔 것은 사유가 풀려도 멈춘 채, 사람이 풀어도 사유가 있으면 멈춘 채", () => {
  const { a, state } = make();
  state.setHolds(["mute"]);
  state.setUser(true);
  state.setHolds([]);
  assert.equal(a.state.status, "paused", "음소거가 풀려도 멈춰 둔다");
  state.setHolds(["mute"]);
  state.setUser(false);
  assert.equal(a.state.status, "paused", "음소거가 남아 있다");
  state.setHolds([]);
  assert.equal(a.state.status, "playing");
});

test("값이 그대로여도 오디오가 어긋났으면 바로잡는다", () => {
  const { a, seen, state } = make();
  state.setHolds(["alone"]);
  a.state = { status: "playing" }; // 재연결 등으로 오디오만 다시 재생된 경우
  state.setHolds(["alone"]);
  assert.equal(a.state.status, "paused");
  assert.equal(seen.length, 1);
});

test("버퍼링 · 곡 없음 · AutoPaused 에는 손대지 않는다(재생으로 넘어오는 순간 다시 맞춘다)", () => {
  for (const status of ["buffering", "idle", "autopaused"]) {
    const { a, state } = make(status);
    state.setUser(true);
    assert.equal(a.state.status, status);
    assert.equal(state.silent, true);
    a.state = { status: "playing" };
    state.apply();
    assert.equal(a.state.status, "paused", status);
  }
});

test("버리면 알리지 않고 비운다", () => {
  const { seen, state } = make();
  state.setUser(true);
  state.setHolds(["stage"]);
  const before = seen.length;
  state.reset();
  assert.equal(state.silent, false);
  assert.equal(state.userPaused, false);
  assert.equal(state.holds.size, 0);
  assert.equal(seen.length, before);
});
