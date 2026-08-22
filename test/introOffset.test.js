"use strict";

// src/MusicPlayer.js _introOffsetMs — 신규 재생의 인트로 초기 오프셋 산출.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const MusicPlayer = require("../src/MusicPlayer");

const intro = MusicPlayer.prototype._introOffsetMs;

test("_introOffsetMs: 0 부근 시작 인트로 → 끝(ms)", () => {
  assert.equal(intro.call(null, { sponsor: { skipSegments: [{ start: 0, end: 138, categories: ["intro"] }] } }), 138000);
  assert.equal(intro.call(null, { sponsor: { skipSegments: [{ start: 0.8, end: 8.4, categories: ["music_offtopic"] }] } }), 8400);
});

test("_introOffsetMs: 시작이 1초 초과면 인트로 아님 → 0", () => {
  assert.equal(intro.call(null, { sponsor: { skipSegments: [{ start: 100, end: 130, categories: ["music_offtopic"] }] } }), 0);
});

test("_introOffsetMs: 구간/센서 없으면 0", () => {
  assert.equal(intro.call(null, { sponsor: { skipSegments: [] } }), 0);
  assert.equal(intro.call(null, {}), 0);
  assert.equal(intro.call(null, { sponsor: null }), 0);
});
