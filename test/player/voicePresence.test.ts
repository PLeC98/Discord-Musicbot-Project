// src/player/voicePresence.ts — 음성 상태 이벤트를 무슨 일로 읽나(강제 퇴장 · 채널 사라짐 · 채널 이동 · 음소거 · 혼자 남음).
// 봇 자신의 상태는 진짜 음성 연결(voiceLink)이 가른다. 가짜 서버 · 플레이어로 무엇을 불렀는지만 본다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { onVoiceStateUpdate } from "../../src/player/voicePresence.ts";
import { VoiceLink } from "../../src/player/voiceLink.ts";
import * as playerEvents from "../../src/player/events.ts";
import type { Client, Guild, VoiceState } from "discord.js";
import type { Player } from "../../src/player/Player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import * as tracks from "../helpers/tracks.ts";

const BOT = "bot1";

type Member = { user: { bot: boolean } };

type Options = { humans?: number; channelExists?: boolean; paused?: string[]; currentTrack?: QueuedTrack | null };

function setup({ humans = 1, channelExists = true, paused = [], currentTrack = tracks.youtube("aaaaaaaaaaa", { title: "곡" }) }: Options = {}) {
  const calls: string[] = [];
  const pool = new Map<string, Member>([[BOT, { user: { bot: true } }]]);
  for (let i = 0; i < humans; i++) pool.set(`u${i}`, { user: { bot: false } });
  const members = Object.assign(pool, { filter: (fn: (member: Member) => boolean) => ({ size: [...pool.values()].filter(fn).length }) });
  const channels = new Map(channelExists ? [["vc1", { id: "vc1", members, isVoiceBased: () => true }]] : []);
  const guild = fake<Guild>({ id: "g1", members: { me: { id: BOT } }, channels: { cache: channels } });

  const player = fakePlayer({
    guild,
    voiceChannel: { id: "vc1" },
    currentTrack,
    queue: [tracks.youtube("bbbbbbbbbbb", { title: "다음" })],
    pauseReasons: new Set(paused),
    dispose: async (o: { reason: string; session: string; panel?: string }) => calls.push(`dispose:${o.reason}:${o.session}:${o.panel ?? "-"}`),
    pauseFor: (r: string) => (calls.push(`pause:${r}`), true),
    resumeFor: (r: string) => (calls.push(`resume:${r}`), true),
    movedVoiceStatus: (from: string) => calls.push(`status-moved:${from}`),
    idle: {
      startAlone: () => calls.push("startAlone"),
      cancelAlone: (resume: boolean) => calls.push(`cancelAlone:${resume}`),
    },
  });
  player.voice = new VoiceLink(player);
  const players = new Map<string, Player>([["g1", player]]);
  const client = fake<Client>({
    user: { id: BOT },
    players,
  });
  // 이 플레이어가 화면에 알린 것
  playerEvents.on("refresh", async (p) => p === player && calls.push("embed:update"));
  playerEvents.on("ended", async (p, reason) => p === player && calls.push(`embed:end:${reason}`));
  const state = (id: string, channelId: string | null, extra: Record<string, unknown> = {}) => fake<VoiceState>({ id, channelId, guild, ...extra });
  return { calls, client, player, players, guild, state };
}

test("플레이어가 없는 서버는 아무것도 안 한다", async () => {
  const { client, calls, players, state } = setup();
  players.clear();
  await onVoiceStateUpdate(client, state("u9", null), state("u9", "vc1"));
  assert.deepEqual(calls, []);
});

test("봇이 음성에서 쫓겨나면 세션을 지우고 끝난 패널(disconnected)로 버린다", async () => {
  const { client, calls, state } = setup();
  await onVoiceStateUpdate(client, state(BOT, "vc1"), state(BOT, null));
  assert.deepEqual(calls, ["dispose:봇이 음성에서 강제 퇴장됨:remove:disconnected"]);
});

test("봇이 있던 채널이 지워져 빠졌으면 강제 퇴장이 아니라 채널 사라짐으로 버린다", async () => {
  const { client, calls, state } = setup({ channelExists: false });
  await onVoiceStateUpdate(client, state(BOT, "vc1"), state(BOT, null));
  assert.deepEqual(calls, ["dispose:봇의 음성 채널이 사라짐:remove:disconnected"]);
});

test("봇이 다른 채널로 옮겨지면 기록과 채널 상태를 맞추고 혼자 남음을 풀고 패널을 고친다", async () => {
  const { client, calls, player, state } = setup();
  await onVoiceStateUpdate(client, state(BOT, "vc0"), state(BOT, "vc2", { channel: { id: "vc2" } }));
  assert.equal(player.voiceChannel?.id, "vc2");
  assert.deepEqual(calls.slice(0, 3), ["status-moved:vc0", "cancelAlone:false", "embed:update"]);
});

test("봇이 처음 참가한 것은 옮겨진 것이 아니다", async () => {
  const { client, calls, player, state } = setup();
  await onVoiceStateUpdate(client, state(BOT, null), state(BOT, "vc1", { channel: { id: "vc1" } }));
  assert.equal(player.voiceChannel?.id, "vc1");
  assert.ok(!calls.includes("cancelAlone:false"));
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

test("봇의 채널이 사라졌으면 세션을 지우고 버린다", async () => {
  const { client, calls, state } = setup({ channelExists: false });
  await onVoiceStateUpdate(client, state("u0", "vc1"), state("u0", null));
  assert.deepEqual(calls, ["dispose:봇의 음성 채널이 사라짐:remove:disconnected"]);
});

test("다른 채널의 일은 보지 않는다", async () => {
  const { client, calls, state } = setup({ humans: 0 });
  await onVoiceStateUpdate(client, state("u0", "vc7"), state("u0", "vc8"));
  assert.deepEqual(calls, []);
});
