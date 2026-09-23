// src/player/playbackState.js — 재생 단계와 끝 처리 중인가.

import { test } from "node:test";
import assert from "node:assert/strict";
import PlaybackState from "../../src/player/playbackState.js";

test("단계: idle → starting → playing → (끝) idle → starting … 버리면 disposed", () => {
  const s = new PlaybackState();
  assert.equal(s.phase, "idle");
  s.to("starting");
  assert.equal(s.starting, true);
  s.to("playing");
  s.to("idle");
  s.to("starting");
  s.to("disposed");
  assert.equal(s.phase, "disposed");
});

test("허용되지 않은 전이도 따른다(재생을 멈추면 안 된다). 로그로만 드러낸다", () => {
  const s = new PlaybackState();
  s.to("disposed");
  s.to("starting"); // 버린 플레이어로 다시 틀려 한다
  assert.equal(s.phase, "starting");
});

test("끝 처리는 겹치지 않는다. 먼저 온 끝이 처리하는 동안 뒤에 온 끝은 버린다", () => {
  const s = new PlaybackState();
  assert.equal(s.beginEnd(), true);
  assert.equal(s.beginEnd(), false);
  // 끝 처리가 다음 곡을 트는 동안 단계는 따로 움직인다
  s.to("starting");
  s.to("playing");
  assert.equal(s.ending, true);
  s.finishEnd();
  assert.equal(s.beginEnd(), true);
});
