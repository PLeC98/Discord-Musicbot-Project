// src/dashboard/status/ — 봇 상태 탭이 모으는 것: 최근 15분(15초 구간마다 한 점, 60점까지) · 게이트웨이 재수립 · 자식 프로세스

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AudioPlayerStatus } from "@discordjs/voice";
import { Events, type Client } from "discord.js";
import { fakeBot } from "../helpers/fake.ts";
import { _tick, stopVitals } from "../../src/infra/vitals.ts";
import { startStatusHistory, statusHistory } from "../../src/dashboard/status/history.ts";
import { _reset, gateway, watchGateway } from "../../src/dashboard/status/gateway.ts";
import { processSummary } from "../../src/dashboard/status/processes.ts";
import { inGuild } from "../../src/infra/guild-context.ts";
import * as registry from "../../src/infra/process-registry.ts";
import logSink from "../../src/infra/log/sink.ts";
import { recentProblems } from "../../src/dashboard/status/env.ts";

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

test("최근 15분: 구간마다 한 점. 소리를 내는 플레이어 수(멈춤 · 곡 없음은 빼고) · 디스코드 지연 · heap 사용률", () => {
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

// 게이트웨이 로그: 끊김 하나에 줄 하나. 수준은 까닭으로(정상 절차 info, 그 밖 warn, 다시 붙지 않음 error)
const gatewayLines: { level: number; msg: string }[] = [];
logSink.addDestination((rec) => {
  if (rec.category === "discord" && typeof rec.msg === "string" && rec.level >= 30) gatewayLines.push({ level: rec.level, msg: rec.msg });
});
const destroying = (reason: string, code: number) => `[WS => Shard 0] Destroying shard\n\tReason: ${reason}\n\tCode: ${code}\n\tRecover: Resume`;
function gatewayRun(steps: (client: EventEmitter) => void) {
  _reset();
  gatewayLines.length = 0;
  const client = new EventEmitter();
  const stop = watchGateway(client as unknown as Client);
  steps(client);
  stop();
  return gatewayLines.map(({ level, msg }) => `${level} ${msg}`);
}

test("게이트웨이 로그: 디스코드가 다시 붙으라고 한 것은 다시 붙을 때 info 한 줄", () => {
  const lines = gatewayRun((client) => {
    client.emit(Events.Debug, destroying("Told to reconnect by Discord", 4200));
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.ShardResume, 0, 5);
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^30 게이트웨이에 다시 붙었습니다\(이어 붙음, 1번 시도, 까닭: 디스코드가 다시 붙으라고 함\(op 7\) · 코드 4200\)/);
});

test("게이트웨이 로그: 비정상 닫힘은 끊길 때 warn, 붙을 때 info. 까닭이 시도 알림보다 늦게 와도 같다", () => {
  const lines = gatewayRun((client) => {
    // 디스코드 쪽에서 닫혔다: 시도 알림이 먼저, 닫은 까닭은 그 뒤
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.Debug, destroying("none", 1006));
    client.emit(Events.ShardError, new Error("connect ECONNREFUSED"), 0);
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.ShardReady, 0);
  });
  assert.deepEqual(lines, ["40 게이트웨이 연결이 끊겼습니다 (샤드 0): 닫힘 코드 1006. 다시 붙는 중입니다", "30 게이트웨이에 다시 붙었습니다(새로 붙음, 2번 시도, 까닭: 닫힘 코드 1006 · 연결 오류 1번(첫: connect ECONNREFUSED))."]);
});

test("게이트웨이 로그: 열리기 전에 닫힌 것은 붙을 때 warn 으로 남기고, 그 까닭이 다음 끊김에 남지 않는다", () => {
  const lines = gatewayRun((client) => {
    client.emit(Events.Debug, destroying("none", 1006));
    client.emit(Events.ShardReady, 0);
    client.emit(Events.Debug, destroying("Told to reconnect by Discord", 4200));
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.ShardResume, 0, 5);
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^40 게이트웨이에 다시 붙었습니다\(새로 붙음, 0번 시도, 까닭: 닫힘 코드 1006\)/);
  assert.match(lines[1], /^30 .*까닭: 디스코드가 다시 붙으라고 함\(op 7\)/);
});

test("게이트웨이 로그: 다시 붙지 않는 닫힘은 오류와 합쳐 error 한 줄", () => {
  const lines = gatewayRun((client) => {
    client.emit(Events.ShardError, new Error("Authentication failed"), 0);
    client.emit(Events.Debug, destroying("none", 4004));
    client.emit(Events.ShardDisconnect, { code: 4004 }, 0);
  });
  assert.deepEqual(lines, ["50 게이트웨이 연결이 닫혀 다시 붙지 않습니다 (샤드 0): 닫힘 코드 4004 AuthenticationFailed · Authentication failed"]);
});

test("자식 프로세스: 프로그램 · 서버 이름 · 일. 재생 · 다음 곡 일인데 그 서버에 플레이어가 없으면 남은 것", () => {
  let pid = 910_001;
  const spawn = (file: string, label: string) => registry.register({ pid: pid++, exitCode: null, signalCode: null, spawnfile: file }, label);
  const releases = [inGuild("g1", () => spawn("ffmpeg", "ffmpeg:playback"), "play"), inGuild("g2", () => spawn("yt-dlp", "yt-dlp"), "prefetch"), inGuild("g2", () => spawn("yt-dlp", "yt-dlp"), "lookup"), spawn("node", "bgutil")];
  try {
    const client = { guilds: { cache: new Map([["g1", { name: "하나" }]]) } } as unknown as Client;
    const { total, byLabel, oldest } = processSummary(client, new Map([["g1", {}]]));
    assert.equal(total, 4);
    assert.deepEqual(byLabel, [
      { label: "yt-dlp", count: 2 },
      { label: "ffmpeg", count: 1 },
      { label: "node", count: 1 },
    ]);
    const by = Object.fromEntries(oldest.map((p) => [`${p.label}:${p.job}`, [p.guildName, p.stray, p.memMb]]));
    assert.deepEqual(by, { "ffmpeg:play": ["하나", false, null], "yt-dlp:prefetch": [null, true, null], "yt-dlp:lookup": [null, false, null], "node:null": [null, false, null] });
  } finally {
    for (const release of releases) release();
  }
});

test("최근 경고 · 오류: 같은 글은 한 줄로(횟수 · 마지막 때), 최근 것부터 셋", () => {
  const before = recentProblems();
  const at = Date.now();
  const say = (level: number, msg: string, dt: number) => logSink.record({ level, time: at + dt, msg });
  say(40, "status 시험: 느림", 1);
  say(50, "status 시험: 실패", 2);
  say(40, "status 시험: 느림", 3);
  say(40, "status 시험: 끝", 4);
  const { warn, error, lines } = recentProblems();
  assert.deepEqual([warn - before.warn, error - before.error], [3, 1]);
  assert.deepEqual(
    lines.map((one) => [one.level, one.text, one.count, one.ts - at]),
    [
      ["warn", "status 시험: 끝", 1, 4],
      ["warn", "status 시험: 느림", 2, 3],
      ["error", "status 시험: 실패", 1, 2],
    ],
  );
});
