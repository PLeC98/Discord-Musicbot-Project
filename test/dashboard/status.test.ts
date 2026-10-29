// src/dashboard/status/ — 봇 상태 탭이 모으는 것: 최근 15분(15초 구간마다 한 점, 60점까지) · 게이트웨이 재연결 · 자식 프로세스

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
import { sortProcesses } from "../../src/dashboard/status/process-order.ts";
import { playerRows } from "../../src/dashboard/status/players.ts";
import { STATUS_QUERY, STRAY_SHOWN, type ProcessRow } from "../../src/dashboard/contract/admin.ts";
import type { PlayerRegistry } from "../../src/player/registry.ts";
import { inGuild } from "../../src/infra/guild-context.ts";
import * as registry from "../../src/infra/process-registry.ts";
import logSink from "../../src/infra/log/sink.ts";
import { recentProblems } from "../../src/dashboard/status/env.ts";

after(stopVitals);

// 멈춤은 플레이어 값이다(사람의 뜻 · 억제 사유). 가짜는 오디오가 멈춘 것을 멈춤으로 둔다
const player = (status: AudioPlayerStatus) => ({ audioPlayer: { state: { status } }, paused: status === AudioPlayerStatus.Paused });
const bot = fakeBot({
  client: { ws: { ping: 42 } },
  players: new Map<string, unknown>([
    ["1", player(AudioPlayerStatus.Playing)],
    ["2", player(AudioPlayerStatus.Paused)],
    ["3", player(AudioPlayerStatus.Idle)],
    ["4", player(AudioPlayerStatus.Playing)],
  ]),
});

// 구간을 닫으면 업로드를 받은 뒤 점을 넣는다(시스템 업로드는 읽지 않는 것으로 바꿔 프로그램을 띄우지 않는다)
const closeWindows = async (n: number) => {
  for (let i = 0; i < n * 5; i++) _tick();
  await new Promise((resolve) => setImmediate(resolve));
};

test("최근 15분: 구간마다 한 점. 소리를 내는 플레이어 수(멈춤 · 곡 없음은 빼고) · 디스코드 지연 · heap 사용률", async () => {
  startStatusHistory(bot, { readSystem: async () => null });
  const before = Date.now();
  await closeWindows(1);

  const history = statusHistory();
  assert.equal(history.stepMs, 15_000);
  assert.ok(history.endAt >= before);
  assert.deepEqual(history.playing, [2]);
  assert.deepEqual(history.ping, [42]);
  assert.equal(history.heapPct.length, 1);
  assert.ok(history.heapPct[0] > 0 && history.heapPct[0] < 100);
  for (const series of [history.loopP99, history.cpuBot, history.cpuSystem]) assert.equal(series.length, 1);
  // 인코딩 워커를 띄우지 않았으면 응답 시간은 0
  assert.deepEqual(history.encodeRtt, [0]);
  assert.deepEqual(history.encodeLate, [0]);
  // 시스템 업로드를 못 읽은 구간은 0
  assert.equal(history.uploadBot.length, 1);
  assert.deepEqual(history.uploadSystem, [0]);
});

test("최근 15분: 60점을 넘으면 오래된 것부터 버린다", async () => {
  await closeWindows(70);
  assert.equal(statusHistory().ping.length, 60);
});

test("게이트웨이: 처음 연결은 세지 않고, 끊긴 동안은 몇 번째 시도인지, 재연결되면 횟수 하나", () => {
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

  // 세션을 재개하지 못하고 새 세션으로 연결돼도 재연결
  client.emit(Events.ShardReconnecting, 0);
  client.emit(Events.ShardReady, 0);
  assert.deepEqual(gateway(), { reconnects: 2, retryAttempt: null });

  stop();
  client.emit(Events.ShardReconnecting, 0);
  assert.deepEqual(gateway(), { reconnects: 2, retryAttempt: null }, "끊으면 더 듣지 않는다");
});

// 게이트웨이 로그: 끊김 하나에 줄 하나. 수준은 까닭으로(정상 절차 info, 그 밖 warn, 재연결하지 않음 error)
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

test("게이트웨이 로그: 디스코드가 재연결을 요청한 것은 재연결될 때 info 한 줄", () => {
  const lines = gatewayRun((client) => {
    client.emit(Events.Debug, destroying("Told to reconnect by Discord", 4200));
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.ShardResume, 0, 5);
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^30 게이트웨이 재연결: 세션 재개 \| 시도 1회 \| 원인=디스코드가 재연결을 요청함\(op 7\) · 코드 4200/);
});

test("게이트웨이 로그: 비정상 닫힘은 끊길 때 warn, 재연결될 때 info. 까닭이 시도 알림보다 늦게 와도 같다", () => {
  const lines = gatewayRun((client) => {
    // 디스코드 쪽에서 닫혔다: 시도 알림이 먼저, 닫은 까닭은 그 뒤
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.Debug, destroying("none", 1006));
    client.emit(Events.ShardError, new Error("connect ECONNREFUSED"), 0);
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.ShardReady, 0);
  });
  assert.deepEqual(lines, ["40 게이트웨이 연결이 끊겼습니다 (샤드 0): 닫힘 코드 1006. 재연결하는 중입니다", "30 게이트웨이 재연결: 새 세션 | 시도 2회 | 원인=닫힘 코드 1006 · 연결 오류 1번(첫: connect ECONNREFUSED)"]);
});

test("게이트웨이 로그: 열리기 전에 닫힌 것은 재연결될 때 warn 으로 남기고, 그 까닭이 다음 끊김에 남지 않는다", () => {
  const lines = gatewayRun((client) => {
    client.emit(Events.Debug, destroying("none", 1006));
    client.emit(Events.ShardReady, 0);
    client.emit(Events.Debug, destroying("Told to reconnect by Discord", 4200));
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.ShardResume, 0, 5);
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^40 게이트웨이 재연결: 새 세션 \| 시도 0회 \| 원인=닫힘 코드 1006/);
  assert.match(lines[1], /^30 .*원인=디스코드가 재연결을 요청함\(op 7\)/);
});

test("게이트웨이 로그: 재연결하지 않는 닫힘은 오류와 합쳐 error 한 줄", () => {
  const lines = gatewayRun((client) => {
    client.emit(Events.ShardError, new Error("Authentication failed"), 0);
    client.emit(Events.Debug, destroying("none", 4004));
    client.emit(Events.ShardDisconnect, { code: 4004 }, 0);
  });
  assert.deepEqual(lines, ["50 게이트웨이 연결이 닫혀 재연결하지 않습니다 (샤드 0): 닫힘 코드 4004 AuthenticationFailed · Authentication failed"]);
});

test("자식 프로세스: 프로그램 · 서버 이름 · 일. 재생 · 다음 곡 일인데 그 서버에 플레이어가 없으면 잔류 의심", () => {
  let pid = 910_001;
  const spawn = (file: string, label: string) => registry.register({ pid: pid++, exitCode: null, signalCode: null, spawnfile: file }, label);
  const releases = [inGuild("g1", () => spawn("ffmpeg", "ffmpeg:playback"), "play"), inGuild("g2", () => spawn("yt-dlp", "yt-dlp"), "prefetch"), inGuild("g2", () => spawn("yt-dlp", "yt-dlp"), "lookup"), spawn("node", "bgutil")];
  try {
    const client = { guilds: { cache: new Map([["g1", { name: "하나" }]]) } } as unknown as Client;
    const { total, byLabel, rows, stray, strayMore, memMb } = processSummary(client, new Map([["g1", {}]]), STATUS_QUERY);
    assert.equal(total, 4);
    assert.deepEqual([stray.map((p) => p.job), strayMore, memMb], [["prefetch"], 0, 0], "잔류 의심 프로세스 · 못 잰 메모리는 합에 0");
    assert.deepEqual(byLabel, [
      { label: "yt-dlp", count: 2 },
      { label: "ffmpeg", count: 1 },
      { label: "node", count: 1 },
    ]);
    const by = Object.fromEntries(rows.map((p) => [`${p.label}:${p.job}`, [p.guildName, p.stray, p.memMb]]));
    assert.deepEqual(by, { "ffmpeg:play": ["하나", false, null], "yt-dlp:prefetch": [null, true, null], "yt-dlp:lookup": [null, false, null], "node:null": [null, false, null] });
  } finally {
    for (const release of releases) release();
  }
});

test("자식 프로세스: 구간만 행으로, 잔류 의심 프로세스는 앞 STRAY_SHOWN 개와 넘는 수", () => {
  let pid = 920_001;
  const releases = Array.from({ length: STRAY_SHOWN + 3 }, () => inGuild("gone", () => registry.register({ pid: pid++, exitCode: null, signalCode: null, spawnfile: "ffmpeg" }, "ffmpeg:playback"), "play"));
  try {
    const client = { guilds: { cache: new Map() } } as unknown as Client;
    const summary = processSummary(client, new Map(), { procs: { from: 5, count: 4 }, sort: "pid", desc: false });
    assert.deepEqual([summary.total, summary.from, summary.rows.map((p) => p.pid)], [STRAY_SHOWN + 3, 5, [920_006, 920_007, 920_008, 920_009]]);
    assert.deepEqual([summary.stray.length, summary.strayMore], [STRAY_SHOWN, 3]);
  } finally {
    for (const release of releases) release();
  }
});

// 정렬 테스트용 행: 이름 · 일 · 나이만 다르게
const proc = (pid: number, ageMs: number, more: Partial<ProcessRow> = {}): ProcessRow => ({ pid, label: "ffmpeg", ageMs, memMb: null, guildId: null, guildName: null, job: null, stray: false, ...more });
const pids = (rows: ProcessRow[]) => rows.map((p) => p.pid);

test("프로세스 정렬: 방향은 고른 열에만, 같은 값끼리는 늘 오래된 것부터(같으면 pid)", () => {
  const rows = () => [proc(3, 10, { memMb: 40 }), proc(1, 30, { memMb: 40 }), proc(2, 30, { memMb: null }), proc(4, 20, { memMb: 90 })];
  assert.deepEqual(pids(sortProcesses(rows(), "mem", true)), [4, 1, 3, 2], "못 잰 것은 가장 작게");
  assert.deepEqual(pids(sortProcesses(rows(), "mem", false)), [2, 1, 3, 4], "같은 40 끼리는 오름차순에서도 오래된 것부터");
  assert.deepEqual(pids(sortProcesses(rows(), "age", true)), [1, 2, 4, 3]);
  assert.deepEqual(pids(sortProcesses(rows(), "age", false)), [3, 4, 1, 2]);
  const labels = [proc(1, 1, { label: "yt-dlp" }), proc(2, 2, { label: "ffmpeg" }), proc(3, 3, { label: "node" })];
  assert.deepEqual(pids(sortProcesses(labels, "label", false)), [2, 3, 1]);
});

test("프로세스 정렬(작업): 서버 이름 있는 작업(이름 가나다 → 재생 · 다음 곡 · 곡 찾기) → 나간 서버 → 서버 밖 작업 → 봇 헬퍼", () => {
  const rows = [proc(1, 1, { job: "pot-server" }), proc(2, 1, { job: "lookup" }), proc(3, 1, { job: "play", guildId: "x" }), proc(4, 1, { job: "lookup", guildId: "b", guildName: "나비" }), proc(5, 1, { job: "play", guildId: "b", guildName: "나비" }), proc(6, 1, { job: "prefetch", guildId: "a", guildName: "가람" }), proc(7, 1, { job: "net-stats" }), proc(8, 1, { job: "prefetch" })];
  assert.deepEqual(pids(sortProcesses([...rows], "job", false)), [6, 5, 4, 3, 8, 2, 1, 7]);
  assert.deepEqual(pids(sortProcesses([...rows], "job", true)), [7, 1, 2, 8, 3, 4, 5, 6]);
});

test("플레이어: 상태별 개수 · 합계는 전부, 행은 필터링된 것(상태 · 검색)의 구간만, 멤버 표시는 그 행만", () => {
  const players = new Map(
    [
      ["a", "가요 광장", AudioPlayerStatus.Playing, "봄날"],
      ["b", "음악 감상실", AudioPlayerStatus.Paused, "밤편지"],
      ["c", "게임방", AudioPlayerStatus.Idle, null],
      ["d", "노래방", AudioPlayerStatus.Playing, "음악의 숲"],
    ].map(([id, name, status, title]) => [id, { guild: { id, name, icon: null, members: { me: null } }, audioPlayer: { state: { status } }, paused: status === AudioPlayerStatus.Paused, currentTrack: title ? { title, artist: "가수", duration: 200 } : null, queue: { length: 2 } }]),
  ) as unknown as PlayerRegistry;
  const asked: string[] = [];
  const client = { guilds: { cache: { get: (id: string) => (asked.push(id), { members: { cache: new Map([["viewer", {}]]) } }) } } } as unknown as Client;
  const view = playerRows(client, players, { players: { from: 0, count: 30 }, states: ["playing", "paused"], q: "음악" }, "viewer", null);
  assert.deepEqual(view.counts, { playing: 2, paused: 1, idle: 1 });
  assert.equal(view.queued, 8);
  assert.deepEqual([view.matched, view.from, view.rows.map((r) => r.guildId)], [2, 0, ["b", "d"]], "서버 이름 · 곡 제목으로 찾는다");
  assert.deepEqual(asked, ["b", "d"], "멤버 표시는 보낸 행만 본다");
  const second = playerRows(client, players, { players: { from: 1, count: 1 }, states: ["playing", "paused", "idle"], q: "" }, "viewer", null);
  assert.deepEqual([second.matched, second.from, second.rows.map((r) => r.guildId)], [4, 1, ["b"]], "삽입 순서로 자른다");
  assert.deepEqual(playerRows(client, players, { ...STATUS_QUERY, states: [] }, "viewer", null).rows, []);
});

test("최근 경고 · 오류: 같은 글은 한 줄로(횟수 · 마지막 때), 최근 것부터 셋", () => {
  const before = recentProblems();
  const at = Date.now();
  const say = (level: number, msg: string, dt: number) => logSink.record({ level, time: at + dt, msg });
  say(40, "status 테스트: 느림", 1);
  say(50, "status 테스트: 실패", 2);
  say(40, "status 테스트: 느림", 3);
  say(40, "status 테스트: 끝", 4);
  const { warn, error, lines } = recentProblems();
  assert.deepEqual([warn - before.warn, error - before.error], [3, 1]);
  assert.deepEqual(
    lines.map((one) => [one.level, one.text, one.count, one.ts - at]),
    [
      ["warn", "status 테스트: 끝", 1, 4],
      ["warn", "status 테스트: 느림", 2, 3],
      ["error", "status 테스트: 실패", 1, 2],
    ],
  );
});
