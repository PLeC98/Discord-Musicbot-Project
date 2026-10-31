// src/player/voice-presence.ts: 음성 상태 이벤트를 무슨 일로 읽나(강제 퇴장 · 채널 사라짐 · 채널 이동 · 억제 사유 맞추기).
// 봇 자신의 상태는 진짜 음성 연결(voiceLink)이 구분한다. 억제 사유 계산은 플레이어(syncHolds)와 rules/holds 테스트가 본다. 여기서는 무엇을 불렀는지만 본다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { onVoiceStateUpdate } from "../../src/player/voice-presence.ts";
import { VoiceLink } from "../../src/player/voice-link.ts";
import * as playerEvents from "../../src/player/events.ts";
import type { Client, Guild, VoiceBasedChannel, VoiceState } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import * as tracks from "../helpers/tracks.ts";
import { ChannelType } from "discord.js";
import * as staySeats from "../../src/store/stay-seats.ts";
import { openTempStore } from "../helpers/temp-store.ts";

const BOT = "bot1";

// 24/7 자리를 적는다
const store = openTempStore("voice-presence-");
after(() => store.close());

type Member = { user: { bot: boolean } };

type Options = { humans?: number; channelExists?: boolean; currentTrack?: QueuedTrack | null };

function setup({ humans = 1, channelExists = true, currentTrack = tracks.youtube("aaaaaaaaaaa", { title: "곡" }) }: Options = {}) {
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
    dispose: async (o: { reason: string; session: string; panel?: string }) => calls.push(`dispose:${o.reason}:${o.session}:${o.panel ?? "-"}`),
    syncHolds: ({ moved = false } = {}) => calls.push(moved ? "sync:moved" : "sync"),
    movedVoiceStatus: (from: string) => calls.push(`status-moved:${from}`),
  });
  player.voice = new VoiceLink(player);
  const players = new Map<string, Player>([["g1", player]]);
  const client = fake<Client>({ user: { id: BOT } });
  // 이 플레이어가 화면에 알린 것
  playerEvents.on("refresh", async (p) => p === player && calls.push("embed:update"));
  playerEvents.on("ended", async (p, reason) => p === player && calls.push(`embed:end:${reason}`));
  const state = (id: string, channelId: string | null, extra: Record<string, unknown> = {}) => fake<VoiceState>({ id, channelId, guild, ...extra });
  return { calls, client, player, players, guild, state };
}

test("플레이어가 없는 서버는 아무것도 안 한다", async () => {
  const { client, calls, players, state } = setup();
  players.clear();
  await onVoiceStateUpdate(client, players, state("u9", null), state("u9", "vc1"));
  assert.deepEqual(calls, []);
});

test("봇이 음성에서 쫓겨나면 세션을 삭제하고 끝난 패널(disconnected)로 버린다", async () => {
  const { client, calls, state, players } = setup();
  await onVoiceStateUpdate(client, players, state(BOT, "vc1"), state(BOT, null));
  // 스테이지면 음성 서버의 닫힘 코드를 보고 고르므로 한 틱 뒤에 버린다
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ["dispose:봇이 음성에서 강제 퇴장됨:remove:disconnected"]);
});

test("봇이 있던 채널이 삭제돼 빠졌으면 강제 퇴장이 아니라 채널 사라짐으로 버린다", async () => {
  const { client, calls, state, players } = setup({ channelExists: false });
  await onVoiceStateUpdate(client, players, state(BOT, "vc1"), state(BOT, null));
  assert.deepEqual(calls, ["dispose:봇의 음성 채널이 사라짐:remove:disconnected"]);
});

test("봇이 다른 채널로 옮겨지면 기록과 채널 상태를 맞추고, 옮겨졌다고 알려 억제 사유를 맞추고 패널을 고친다", async () => {
  const { client, calls, player, state, players, guild } = setup();
  guild.channels.cache.set("vc2", fake<VoiceBasedChannel>({ id: "vc2", members: new Map(), isVoiceBased: () => true }));
  await onVoiceStateUpdate(client, players, state(BOT, "vc0"), state(BOT, "vc2", { channel: { id: "vc2" } }));
  assert.equal(player.voiceChannel?.id, "vc2");
  assert.deepEqual(calls, ["status-moved:vc0", "sync:moved", "embed:update"], "채널을 고친 뒤에 맞춘다");
});

test("자리에 있던 봇이 옮겨지면 24/7 자리도 따라가고 퇴장 판정을 다시 맞춘다(억제 사유보다 먼저). 스테이지로 옮겨지면 자리는 그대로", async () => {
  for (const [type, want] of [
    [ChannelType.GuildVoice, "vc2"],
    [ChannelType.GuildStageVoice, "vc0"],
  ] as const) {
    const { client, calls, player, state, players, guild } = setup();
    staySeats.set("g1", "vc0", "u1");
    Object.assign(player, { idle: { reconsider: () => calls.push("reconsider") } });
    const vc2 = fake<VoiceBasedChannel>({ id: "vc2", type, members: new Map(), isVoiceBased: () => true });
    guild.channels.cache.set("vc2", vc2);
    await onVoiceStateUpdate(client, players, state(BOT, "vc0"), state(BOT, "vc2", { channel: vc2 }));
    assert.equal(staySeats.seatOf("g1")?.channelId, want);
    assert.deepEqual(calls.slice(0, 3), ["status-moved:vc0", "reconsider", "sync:moved"]);
    staySeats.clear("g1");
  }
});

test("봇이 처음 참가한 것은 옮겨진 것이 아니다", async () => {
  const { client, calls, player, state, players } = setup();
  await onVoiceStateUpdate(client, players, state(BOT, null), state(BOT, "vc1", { channel: { id: "vc1" } }));
  assert.equal(player.voiceChannel?.id, "vc1");
  assert.deepEqual(calls, ["sync"]);
});

test("봇의 음소거 · 봇 채널의 사람 들고 남은 억제 사유를 맞춘다(패널 갱신은 바뀐 만큼 플레이어가)", async () => {
  const mute = setup();
  await onVoiceStateUpdate(mute.client, mute.players, mute.state(BOT, "vc1"), mute.state(BOT, "vc1", { serverMute: true }));
  assert.deepEqual(mute.calls, ["sync"]);

  const left = setup({ humans: 0 });
  await onVoiceStateUpdate(left.client, left.players, left.state("u0", "vc1"), left.state("u0", null));
  assert.deepEqual(left.calls, ["sync"]);

  const back = setup();
  await onVoiceStateUpdate(back.client, back.players, back.state("u0", null), back.state("u0", "vc1"));
  assert.deepEqual(back.calls, ["sync"]);
});

test("봇의 채널이 사라졌으면 세션을 삭제하고 버린다", async () => {
  const { client, calls, state, players } = setup({ channelExists: false });
  await onVoiceStateUpdate(client, players, state("u0", "vc1"), state("u0", null));
  assert.deepEqual(calls, ["dispose:봇의 음성 채널이 사라짐:remove:disconnected"]);
});

test("다른 채널의 일은 보지 않는다", async () => {
  const { client, calls, state, players } = setup({ humans: 0 });
  await onVoiceStateUpdate(client, players, state("u0", "vc7"), state("u0", "vc8"));
  assert.deepEqual(calls, []);
});
