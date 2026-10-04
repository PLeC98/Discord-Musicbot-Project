// src/rules/queue-room.ts — 대기열에 더 넣을 수 있는 곡 수

import { test } from "node:test";
import assert from "node:assert/strict";
import { roomFor, roomLeft } from "../../src/rules/queue-room.ts";

test("roomLeft: 대기열만 세고, 넘쳐 있어도 음수가 아니며, 0이면 끔", () => {
  const p = { queue: ["A", "B"] };
  assert.equal(roomLeft(p, 5), 3, "현재곡은 세지 않는다");
  assert.equal(roomLeft(p, 1), 0);
  assert.equal(roomLeft(p, 0), Infinity);
});

test("roomFor: 지금 곡이 없으면 한 곡 더(첫 곡은 바로 튼다)", () => {
  assert.equal(roomFor({ queue: ["A"], currentTrack: "X" }, 5), 4);
  assert.equal(roomFor({ queue: ["A"], currentTrack: null }, 5), 5);
  assert.equal(roomFor({ queue: [], currentTrack: null }, 0), Infinity);
});
