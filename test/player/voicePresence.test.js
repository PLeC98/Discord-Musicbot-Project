"use strict";

// src/player/voicePresence.js — 음성 상태 이벤트를 무슨 일로 읽나(강제 퇴장 · 채널 이동 · 음소거 · 혼자 남음).
// 가짜 서버 · 플레이어로 무엇을 불렀는지만 본다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { onVoiceStateUpdate } = require("../../src/player/voicePresence");

const BOT = "bot1";

function setup({ humans = 1, channelExists = true, paused = [], currentTrack = { title: "곡" } } = {}) {
  const calls = [];
  const members = new Map([[BOT, { user: { bot: true } }]]);
  for (let i = 0; i < humans; i++) members.set(`u${i}`, { user: { bot: false } });
  members.filter = (fn) => ({ size: [...members.values()].filter(fn).length });
  const channels = new Map(channelExists ? [["vc1", { id: "vc1", members }]] : []);
  const guild = { id: "g1", members: { me: { id: BOT } }, channels: { cache: channels } };

  const player = {
    voiceChannel: { id: "vc1" },
    currentTrack,
    queue: [{ title: "다음" }],
    pauseReasons: new Set(paused),
    pendingEndReason: null,
    cleanup: (reason) => calls.push(`cleanup:${reason}`),
    voice: { followMove: (from, ch) => calls.push(`move:${from}->${ch.id}`) },
    pauseFor: (r) => (calls.push(`pause:${r}`), true),
    resumeFor: (r) => (calls.push(`resume:${r}`), true),
    idle: {
      startAlone: () => calls.push("startAlone"),
      cancelAlone: (resume) => calls.push(`cancelAlone:${resume}`),
    },
  };
  const players = new Map([["g1", player]]);
  const client = {
    user: { id: BOT },
    players,
    musicEmbedManager: {
      updateNowPlayingEmbed: async () => calls.push("embed:update"),
      handlePlaybackEnd: async (_p, { reason }) => calls.push(`embed:end:${reason}`),
    },
  };
  const state = (id, channelId, extra = {}) => ({ id, channelId, guild, ...extra });
  return { calls, client, player, players, guild, state };
}

test("플레이어가 없는 서버는 아무것도 안 한다", async () => {
  const { client, calls, players, state } = setup();
  players.clear();
  await onVoiceStateUpdate(client, state("u9", null), state("u9", "vc1"));
  assert.deepEqual(calls, []);
});

test("봇이 음성에서 쫓겨나면 끝난 패널로 바꾸고 정리하고 레지스트리에서 뺀다", async () => {
  const { client, calls, player, players, state } = setup();
  await onVoiceStateUpdate(client, state(BOT, "vc1"), state(BOT, null));
  assert.deepEqual(calls, ["embed:end:disconnected", "cleanup:봇이 음성에서 강제 퇴장됨"]);
  assert.equal(player.pendingEndReason, "forced-disconnect");
  assert.equal(player.currentTrack, null, "곡과 대기열을 비운다");
  assert.equal(players.has("g1"), false);
});

test("패널을 못 바꿔도 정리는 한다", async () => {
  const { client, calls, players, state } = setup();
  client.musicEmbedManager.handlePlaybackEnd = async () => {
    throw new Error("x");
  };
  await onVoiceStateUpdate(client, state(BOT, "vc1"), state(BOT, null));
  assert.deepEqual(calls, ["cleanup:봇이 음성에서 강제 퇴장됨"]);
  assert.equal(players.has("g1"), false);
});

test("봇이 다른 채널로 옮겨지면 기록을 맞추고 혼자 남음을 풀고 패널을 고친다", async () => {
  const { client, calls, state } = setup();
  await onVoiceStateUpdate(client, state(BOT, "vc0"), state(BOT, "vc2", { channel: { id: "vc2" } }));
  assert.deepEqual(calls.slice(0, 3), ["move:vc0->vc2", "cancelAlone:false", "embed:update"]);
});

test("봇이 처음 참가한 것은 옮겨진 것이 아니다", async () => {
  const { client, calls, state } = setup();
  await onVoiceStateUpdate(client, state(BOT, null), state(BOT, "vc1", { channel: { id: "vc1" } }));
  assert.ok(!calls.some((c) => c.startsWith("move:")));
});

test("봇이 서버 음소거되면 mute 로 멈추고, 풀리면 mute 를 푼다", async () => {
  const { client, calls, state } = setup();
  await onVoiceStateUpdate(client, state(BOT, "vc1"), state(BOT, "vc1", { serverMute: true }));
  assert.deepEqual(calls.slice(0, 2), ["pause:mute", "embed:update"]);

  calls.length = 0;
  await onVoiceStateUpdate(client, state(BOT, "vc1", { suppress: true }), state(BOT, "vc1"));
  assert.deepEqual(calls.slice(0, 2), ["resume:mute", "embed:update"]);
});

test("봇의 채널에서 사람이 다 나가면 혼자 남음을 시작하고 패널을 고친다", async () => {
  const { client, calls, state } = setup({ humans: 0 });
  await onVoiceStateUpdate(client, state("u0", "vc1"), state("u0", null));
  assert.deepEqual(calls, ["startAlone", "embed:update"]);
});

test("이미 혼자 남아 멈춰 있거나 곡이 없으면 패널은 그대로", async () => {
  const already = setup({ humans: 0, paused: ["alone"] });
  await onVoiceStateUpdate(already.client, already.state("u0", "vc1"), already.state("u0", null));
  assert.deepEqual(already.calls, ["startAlone"]);

  const idle = setup({ humans: 0, currentTrack: null });
  await onVoiceStateUpdate(idle.client, idle.state("u0", "vc1"), idle.state("u0", null));
  assert.deepEqual(idle.calls, ["startAlone"]);
});

test("사람이 돌아오면 혼자 남음을 풀고, 그걸로 멈춰 있었으면 패널을 고친다", async () => {
  const back = setup({ humans: 1, paused: ["alone"] });
  await onVoiceStateUpdate(back.client, back.state("u0", null), back.state("u0", "vc1"));
  assert.deepEqual(back.calls, ["cancelAlone:true", "embed:update"]);

  const busy = setup({ humans: 2 });
  await onVoiceStateUpdate(busy.client, busy.state("u1", null), busy.state("u1", "vc1"));
  assert.deepEqual(busy.calls, ["cancelAlone:true"]);
});

test("봇의 채널이 사라졌으면 정리하고 레지스트리에서 뺀다", async () => {
  const { client, calls, players, state } = setup({ channelExists: false });
  await onVoiceStateUpdate(client, state("u0", "vc1"), state("u0", null));
  assert.deepEqual(calls, ["cleanup:봇의 음성 채널이 사라짐"]);
  assert.equal(players.has("g1"), false);
});

test("다른 채널의 일은 보지 않는다", async () => {
  const { client, calls, state } = setup({ humans: 0 });
  await onVoiceStateUpdate(client, state("u0", "vc7"), state("u0", "vc8"));
  assert.deepEqual(calls, []);
});
