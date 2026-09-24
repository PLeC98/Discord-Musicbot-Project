// src/player/startPlayback.ts introOffsetMs — 신규 재생의 인트로 초기 오프셋 산출.

import { test } from "node:test";
import assert from "node:assert/strict";
import { introOffsetMs as intro } from "../../src/player/startPlayback.ts";

test("introOffsetMs: 0 부근 시작 인트로 → 끝(ms)", () => {
  assert.equal(intro({ skipSegments: [{ start: 0, end: 138, categories: ["intro"] }] }), 138000);
  assert.equal(intro({ skipSegments: [{ start: 0.8, end: 8.4, categories: ["music_offtopic"] }] }), 8400);
});

test("introOffsetMs: 시작이 1초 초과면 인트로 아님 → 0", () => {
  assert.equal(intro({ skipSegments: [{ start: 100, end: 130, categories: ["music_offtopic"] }] }), 0);
});

test("introOffsetMs: 구간/센서 없으면 0", () => {
  assert.equal(intro({ skipSegments: [] }), 0);
  assert.equal(intro({}), 0);
  assert.equal(intro({ sponsor: null }), 0);
});
