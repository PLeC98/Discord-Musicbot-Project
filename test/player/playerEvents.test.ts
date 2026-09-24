// src/player/events.ts — 플레이어가 화면과 대시보드에 알리는 창구.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as playerEvents from "../../src/player/events.ts";
import { fakePlayer } from "../helpers/fake.ts";

// 알림 창구는 플레이어를 건네기만 한다. 가짜는 어느 플레이어인지만 가른다
const player = (id = "") => fakePlayer({ sessionId: id });

afterEach(() => playerEvents._reset());

test("알림을 듣는 쪽이 모두 끝날 때까지 기다린다", async () => {
  const seen: string[] = [];
  playerEvents.on("ended", async (p, reason) => {
    await new Promise((r) => setImmediate(r));
    seen.push(`a:${p.sessionId}:${reason}`);
  });
  playerEvents.on("ended", (p) => seen.push(`b:${p.sessionId}`));
  await playerEvents.ended(player("1"), "queue-end");
  assert.deepEqual(seen.sort(), ["a:1:queue-end", "b:1"]);
});

test("듣는 쪽이 없으면 아무 일도 없다. 떼면 더 듣지 않는다", async () => {
  await playerEvents.refresh(player());
  const seen: number[] = [];
  const off = playerEvents.on("refresh", () => seen.push(1));
  await playerEvents.refresh(player());
  off();
  await playerEvents.refresh(player());
  assert.deepEqual(seen, [1]);
});

test("듣는 쪽의 실패는 알린 쪽으로 올라간다(기다리는 알림)", async () => {
  playerEvents.on("started", () => {
    throw new Error("패널 실패");
  });
  await assert.rejects(playerEvents.started(player(), { id: "u1" }), /패널 실패/);
});

test("대시보드 알림 · 놓기는 기다리지 않고, 실패해도 알린 쪽을 멈추지 않는다", () => {
  const seen: string[] = [];
  playerEvents.on("touched", () => {
    throw new Error("끊김");
  });
  playerEvents.on("touched", (g) => seen.push(`touched:${g}`));
  playerEvents.on("released", (_p, id) => seen.push(`released:${id}`));
  playerEvents.touched("g1");
  playerEvents.released(player(), "t1");
  assert.deepEqual(seen, ["touched:g1", "released:t1"]);
});
