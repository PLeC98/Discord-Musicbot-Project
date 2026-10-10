// src/dashboard/status-history.ts — 봇 상태 탭의 최근 15분: 측정이 15초 칸을 닫을 때마다 한 점, 60점까지

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { AudioPlayerStatus } from "@discordjs/voice";
import { fakeBot } from "../helpers/fake.ts";
import { _tick, stopVitals } from "../../src/infra/vitals.ts";
import { startStatusHistory, statusHistory } from "../../src/dashboard/status-history.ts";

after(stopVitals);

const player = (status: AudioPlayerStatus) => ({ audioPlayer: { state: { status } } });
const bot = fakeBot({
  client: { ws: { ping: 42 } },
  players: new Map<string, unknown>([
    ["1", player(AudioPlayerStatus.Playing)],
    ["2", player(AudioPlayerStatus.Paused)],
    ["3", player(AudioPlayerStatus.Idle)],
    ["4", player(AudioPlayerStatus.Playing)],
  ]),
});

const closeWindows = (n: number) => {
  for (let i = 0; i < n * 5; i++) _tick();
};

test("칸마다 한 점: 소리를 내는 플레이어 수(멈춤 · 곡 없음은 빼고) · 디스코드 지연 · heap 사용률", () => {
  startStatusHistory(bot);
  const before = Date.now();
  closeWindows(1);

  const history = statusHistory();
  assert.equal(history.stepMs, 15_000);
  assert.ok(history.endAt >= before);
  assert.deepEqual(history.playing, [2]);
  assert.deepEqual(history.ping, [42]);
  assert.equal(history.heapPct.length, 1);
  assert.ok(history.heapPct[0] > 0 && history.heapPct[0] < 100);
  for (const series of [history.loopP99, history.cpuBot, history.cpuSystem]) assert.equal(series.length, 1);
});

test("15분(60점)을 넘으면 오래된 것부터 버린다", () => {
  closeWindows(70);
  assert.equal(statusHistory().ping.length, 60);
});
