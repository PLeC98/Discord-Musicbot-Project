"use strict";

// VoiceConnectionManager 의 연결 이벤트 · 헬스체크 · 재연결 · 재개 · 연결 · 이동의 지금 동작을 고정한다
// (구조 리팩터링 0단계). 복구 루프 자체는 voiceConnectionManager.test.js 가 본다.
//
// 음성 라이브러리의 joinVoiceChannel · entersState 를 불러오기 전에 바꿔 끼운다.

const { test, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");

const realVoice = require("@discordjs/voice");
const { VoiceConnectionStatus } = realVoice;

const joins = [];
let enters = async () => {}; // (connection, status, ms) → 성공이면 resolve
const entered = [];

function fakeConnection() {
  const c = new EventEmitter();
  c.state = { status: VoiceConnectionStatus.Ready };
  c.destroyed = 0;
  c.subscribed = [];
  c.rejoins = [];
  c.destroy = () => {
    c.destroyed += 1;
    c.state = { status: VoiceConnectionStatus.Destroyed };
  };
  c.subscribe = (p) => c.subscribed.push(p);
  c.rejoin = (o) => c.rejoins.push(o);
  return c;
}

require.cache[require.resolve("@discordjs/voice")] = {
  id: "@discordjs/voice",
  loaded: true,
  exports: {
    ...realVoice,
    joinVoiceChannel: (opts) => {
      const c = fakeConnection();
      joins.push({ opts, connection: c });
      return c;
    },
    entersState: async (connection, status, ms) => {
      entered.push([status, ms]);
      return enters(connection, status, ms);
    },
  },
};

const VoiceConnectionManager = require("../src/VoiceConnectionManager");

const flush = () => new Promise((done) => setImmediate(done));

function makePlayer({ channel = true } = {}) {
  const guild = { id: "g1", name: "서버", channels: { cache: new Map() }, voiceAdapterCreator: () => ({}), client: { players: new Map() } };
  if (channel) guild.channels.cache.set("vc1", { id: "vc1" });
  const player = {
    guild,
    voiceChannel: { id: "vc1", name: "음성" },
    audioPlayer: { name: "audioPlayer" },
    connection: fakeConnection(),
    currentTrack: { title: "곡" },
    paused: false,
    isRecovering: false,
    recoveryAttempts: 0,
    maxRecoveryAttempts: 5,
    startTime: null,
    pausedTime: 0,
    currentTrackStartOffsetMs: 0,
    lastPlaybackPosition: 0,
    resource: null,
    cleanups: [],
    cleanup(isShutdown, reason) {
      this.cleanups.push(reason);
    },
  };
  guild.client.players.set("g1", player);
  const vcm = new VoiceConnectionManager(player);
  const recoveries = [];
  vcm.startConnectionRecovery = async () => recoveries.push(true);
  return { player, vcm, recoveries };
}

beforeEach(() => {
  joins.length = 0;
  entered.length = 0;
  enters = async () => {};
});

// ── 연결 이벤트 ───────────────────────────────────────────────────────

test("끊김: 수동 해제거나 이미 복구 중이면 아무것도 안 한다", async () => {
  const { player, vcm, recoveries } = makePlayer();
  vcm.setupConnectionEvents();

  player.connection.emit(VoiceConnectionStatus.Disconnected, {}, { reason: "Manual disconnect" });
  player.isRecovering = true;
  player.connection.emit(VoiceConnectionStatus.Disconnected, {}, { reason: 4014 });
  await flush();

  assert.equal(recoveries.length, 0);
  assert.equal(entered.length, 0, "자동 재연결도 기다리지 않는다");
});

test("끊김: Discord 자동 재연결을 5초 · 10초 기다리고, 붙으면 복구하지 않는다", async () => {
  const { player, vcm, recoveries } = makePlayer();
  vcm.setupConnectionEvents();

  player.connection.emit(VoiceConnectionStatus.Disconnected, {}, { reason: 4014 });
  await flush();

  assert.deepEqual(entered, [
    [VoiceConnectionStatus.Connecting, 5000],
    [VoiceConnectionStatus.Ready, 10000],
  ]);
  assert.equal(recoveries.length, 0);
});

test("끊김: 자동 재연결이 안 되면 재생 중일 때만 자체 복구를 시작한다", async () => {
  const { player, vcm, recoveries } = makePlayer();
  enters = async () => {
    throw new Error("시간 초과");
  };
  vcm.setupConnectionEvents();

  player.connection.emit(VoiceConnectionStatus.Disconnected, {}, { reason: 4014 });
  await flush();
  assert.equal(recoveries.length, 1);

  player.paused = true;
  player.connection.emit(VoiceConnectionStatus.Disconnected, {}, { reason: 4014 });
  await flush();
  assert.equal(recoveries.length, 1, "멈춘 중이면 복구하지 않는다");
});

test("파괴됨 · 오류: 재생 중이고 복구 중이 아니면 복구를 시작한다", () => {
  const { player, vcm, recoveries } = makePlayer();
  vcm.setupConnectionEvents();

  player.connection.emit(VoiceConnectionStatus.Destroyed);
  player.connection.emit("error", new Error("x"));
  assert.equal(recoveries.length, 2);

  player.isRecovering = true;
  player.connection.emit(VoiceConnectionStatus.Destroyed);
  assert.equal(recoveries.length, 2, "파괴됨은 복구 중이면 건너뛴다");
  player.connection.emit("error", new Error("x"));
  assert.equal(recoveries.length, 3, "오류는 복구 중인지 보지 않는다(루프가 스스로 막는다)");

  player.currentTrack = null;
  player.isRecovering = false;
  player.connection.emit(VoiceConnectionStatus.Destroyed);
  assert.equal(recoveries.length, 3, "곡이 없으면 복구하지 않는다");
});

test("Ready 로 넘어오면 복구를 끝내고 시도 횟수를 0 으로", () => {
  const { player, vcm } = makePlayer();
  vcm.setupConnectionEvents();
  player.isRecovering = true;
  player.recoveryAttempts = 3;

  player.connection.emit("stateChange", { status: VoiceConnectionStatus.Connecting }, { status: VoiceConnectionStatus.Ready });

  assert.equal(player.isRecovering, false);
  assert.equal(player.recoveryAttempts, 0);
});

test("연결이 없으면 이벤트를 걸지 않는다", () => {
  const { player, vcm } = makePlayer();
  player.connection = null;
  assert.doesNotThrow(() => vcm.setupConnectionEvents());
});

// ── 헬스체크 ─────────────────────────────────────────────────────────

test("헬스체크: 30초마다. 연결이 파괴됐고 재생 중이면 복구, 음성 채널이 사라졌으면 정리하고 레지스트리에서 뺀다", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { player, vcm, recoveries } = makePlayer();
    vcm.startConnectionHealthCheck();
    player.connection.state = { status: VoiceConnectionStatus.Destroyed };

    mock.timers.tick(29999);
    await flush();
    assert.equal(recoveries.length, 0);
    mock.timers.tick(1);
    await flush();
    assert.equal(recoveries.length, 1);
    assert.deepEqual(player.cleanups, []);

    player.guild.channels.cache.clear();
    mock.timers.tick(30000);
    await flush();
    assert.deepEqual(player.cleanups, ["헬스체크: 음성 채널을 찾을 수 없음"]);
    assert.equal(player.guild.client.players.has("g1"), false);
    clearInterval(player.connectionHealthCheck);
  } finally {
    mock.timers.reset();
  }
});

test("헬스체크: 밀려난 플레이어는 정리하되 레지스트리의 현행 플레이어는 지우지 않는다", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { player, vcm } = makePlayer({ channel: false });
    const current = {};
    player.guild.client.players.set("g1", current);
    vcm.startConnectionHealthCheck();

    mock.timers.tick(30000);
    await flush();
    assert.equal(player.cleanups.length, 1);
    assert.equal(player.guild.client.players.get("g1"), current);
    clearInterval(player.connectionHealthCheck);
  } finally {
    mock.timers.reset();
  }
});

// ── 위치 저장 · 재연결 · 재개 ──────────────────────────────────────────

test("위치 저장: 재생 중일 때만, 시작 오프셋 + 흐른 시간 + 쌓인 멈춤 시간", () => {
  const { player, vcm } = makePlayer();
  player.startTime = Date.now() - 2000;
  player.pausedTime = 1000;
  player.currentTrackStartOffsetMs = 10000;

  vcm.savePlaybackPosition();
  assert.ok(Math.abs(player.lastPlaybackPosition - 13000) < 100);

  player.paused = true;
  player.lastPlaybackPosition = 0;
  vcm.savePlaybackPosition();
  assert.equal(player.lastPlaybackPosition, 0);
});

test("강제 재연결: 옛 연결을 부수고 같은 채널에 새로 붙어 구독하고 15초 Ready 를 기다린다", async () => {
  const { player, vcm } = makePlayer();
  const old = player.connection;

  assert.equal(await vcm.forceReconnect(), true);

  assert.equal(old.destroyed, 1);
  assert.equal(joins.length, 1);
  assert.deepEqual({ channelId: joins[0].opts.channelId, guildId: joins[0].opts.guildId }, { channelId: "vc1", guildId: "g1" });
  assert.equal(player.connection, joins[0].connection);
  assert.deepEqual(player.connection.subscribed, [player.audioPlayer]);
  assert.deepEqual(entered, [[VoiceConnectionStatus.Ready, 15000]]);
  assert.ok(player.connection.listenerCount(VoiceConnectionStatus.Disconnected) > 0, "새 연결에 이벤트를 건다");
});

test("강제 재연결: 이미 파괴된 연결은 다시 부수지 않고, Ready 가 안 오면 false", async () => {
  const { player, vcm } = makePlayer();
  const old = player.connection;
  old.state = { status: VoiceConnectionStatus.Destroyed };
  enters = async () => {
    throw new Error("시간 초과");
  };

  assert.equal(await vcm.forceReconnect(), false);
  assert.equal(old.destroyed, 0);
});

test("재개: 리소스가 있으면 오프셋 + 재생량, 없으면 저장해 둔 위치. 실패하면 error 로 곡을 끝낸다", async () => {
  const { player, vcm } = makePlayer();
  const seeks = [];
  const ends = [];
  player.play = async (_i, ms) => seeks.push(ms);
  player.handleTrackEnd = async (r) => ends.push(r);

  player.currentTrackStartOffsetMs = 1000;
  player.resource = { playbackDuration: 4000 };
  await vcm.resumePlaybackAfterRecovery();
  player.resource = null;
  player.lastPlaybackPosition = 7000;
  await vcm.resumePlaybackAfterRecovery();
  assert.deepEqual(seeks, [5000, 7000]);

  player.play = async () => {
    throw new Error("x");
  };
  await vcm.resumePlaybackAfterRecovery();
  assert.deepEqual(ends, ["error"]);

  player.currentTrack = null;
  await vcm.resumePlaybackAfterRecovery();
  assert.deepEqual(ends, ["error"], "곡이 없으면 아무것도 안 한다");
});

// ── 연결 · 이동 · 끊기 ────────────────────────────────────────────────

test("연결: 새로 붙고 구독하고 30초 Ready 를 기다린다", async () => {
  const { player, vcm } = makePlayer();
  player.connection = null;

  assert.equal(await vcm.connect(), true);
  assert.equal(player.connection, joins[0].connection);
  assert.deepEqual(player.connection.subscribed, [player.audioPlayer]);
  assert.deepEqual(entered, [[VoiceConnectionStatus.Ready, 30000]]);
});

test("연결: 어댑터가 없으면 서버를 다시 받아 오며 기다린다", async () => {
  const { player, vcm } = makePlayer();
  const fresh = { ...player.guild, voiceAdapterCreator: () => ({}) };
  player.guild.voiceAdapterCreator = null;
  player.guild.client.guilds = { fetch: async () => fresh };

  assert.equal(await vcm.connect(), true);
  assert.equal(player.guild, fresh, "새 서버 참조로 바꾼다");
});

test("연결: 10초 기다려도 어댑터가 없으면 던진다", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const { player, vcm } = makePlayer();
    player.guild.voiceAdapterCreator = null;
    player.guild.client.guilds = { fetch: async () => null };

    const result = vcm.connect().then(
      () => "ok",
      (e) => e.message,
    );
    for (let i = 0; i < 25; i++) {
      mock.timers.tick(500);
      await flush();
    }
    assert.equal(await result, "Guild voice adapter not ready after waiting");
  } finally {
    mock.timers.reset();
  }
});

test("Ready 가 안 오면 연결은 던진다", async () => {
  const { vcm } = makePlayer();
  enters = async () => {
    throw new Error("시간 초과");
  };
  await assert.rejects(vcm.connect(), /시간 초과/);
});

test("이동: 연결이 있으면 rejoin, 실패하면 부수고 새로 연결한다", async () => {
  const { player, vcm } = makePlayer();
  const conn = player.connection;
  const next = { id: "vc2", name: "다른 방" };

  assert.equal(await vcm.moveToChannel(next), true);
  assert.equal(player.voiceChannel, next);
  assert.deepEqual(conn.rejoins, [{ channelId: "vc2", selfDeaf: false, selfMute: false }]);
  assert.equal(joins.length, 0);

  let first = true;
  enters = async () => {
    if (first) {
      first = false;
      throw new Error("시간 초과");
    }
  };
  assert.equal(await vcm.moveToChannel({ id: "vc3" }), true);
  assert.equal(conn.destroyed, 1);
  assert.equal(joins.length, 1);
  assert.equal(joins[0].opts.channelId, "vc3");

  assert.equal(await vcm.moveToChannel(null), false);
});

test("끊기: 파괴되지 않은 연결만 부수고 비운다", () => {
  const { player, vcm } = makePlayer();
  const conn = player.connection;
  vcm.disconnect();
  assert.equal(conn.destroyed, 1);
  assert.equal(player.connection, null);

  const gone = fakeConnection();
  gone.state = { status: "destroyed" };
  player.connection = gone;
  vcm.disconnect();
  assert.equal(gone.destroyed, 0);
  assert.equal(player.connection, null);
});
