// src/dashboard/status/ — 봇 상태 탭이 모으는 것: 최근 15분(15초 칸마다 한 점, 60점까지) · 게이트웨이 재수립

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Events, type Client } from "discord.js";
import { fakeBot } from "../helpers/fake.ts";
import { _tick, stopVitals } from "../../src/infra/vitals.ts";
import { startStatusHistory, statusHistory } from "../../src/dashboard/status/history.ts";
import { _reset, gateway, watchGateway } from "../../src/dashboard/status/gateway.ts";

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

test("최근 15분: 칸마다 한 점. 소리를 내는 플레이어 수(멈춤 · 곡 없음은 빼고) · 디스코드 지연 · heap 사용률", () => {
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

test("최근 15분: 60점을 넘으면 오래된 것부터 버린다", () => {
  closeWindows(70);
  assert.equal(statusHistory().ping.length, 60);
});

test("게이트웨이: 처음 붙은 것은 세지 않고, 끊긴 동안은 몇 번째 시도인지, 다시 붙으면 재수립 하나", () => {
  _reset();
  const client = new EventEmitter();
  const stop = watchGateway(client as unknown as Client);

  client.emit(Events.ShardReady, 0);
  assert.deepEqual(gateway(), { reconnects: 0, retryAttempt: null });

  client.emit(Events.ShardReconnecting, 0);
  client.emit(Events.ShardReconnecting, 0);
  assert.deepEqual(gateway(), { reconnects: 0, retryAttempt: 2 });
  client.emit(Events.ShardResume, 0, 5);
  assert.deepEqual(gateway(), { reconnects: 1, retryAttempt: null });

  // 이어 붙지 못하고 새로 붙어도 재수립
  client.emit(Events.ShardReconnecting, 0);
  client.emit(Events.ShardReady, 0);
  assert.deepEqual(gateway(), { reconnects: 2, retryAttempt: null });

  stop();
  client.emit(Events.ShardReconnecting, 0);
  assert.deepEqual(gateway(), { reconnects: 2, retryAttempt: null }, "끊으면 더 듣지 않는다");
});
