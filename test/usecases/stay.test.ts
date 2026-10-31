// src/usecases/stay.ts: 24/7 켜기 · 끄기. 자리는 봇이 있는 채널(없으면 부른 사람의 채널에 붙은 뒤), 스테이지는 받지 않는다

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, type Guild, type GuildMember } from "discord.js";
import * as stay from "../../src/usecases/stay.ts";
import * as staySeats from "../../src/store/stay-seats.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { withConfig } from "../helpers/config.ts";
import { fake } from "../helpers/fake.ts";
import type { PlayerSeats } from "../../src/player/registry.ts";

const store = openTempStore("stay-");
after(() => store.close());
afterEach(() => staySeats.clear("g1"));

const guild = fake<Guild>({ id: "g1", name: "서버" });
const member = (mod = true) => fake<GuildMember>({ id: "u1", user: { tag: "사람" }, guild, permissions: { has: () => mod }, voice: { channel: null } });

// 음성에 붙어 있는 플레이어. reconsider 를 부른 횟수를 센다
function seated(channel: { id: string; name: string; type?: ChannelType }) {
  const seen = { reconsider: 0 };
  const player = { voice: { isAlive: () => true }, voiceChannel: channel, idle: { reconsider: () => void seen.reconsider++ } };
  const bot = { players: fake<Pick<PlayerSeats, "get" | "set">>({ get: () => player, set: () => {} }) };
  return { bot, seen };
}

test("켜기: 봇이 있는 채널을 자리로 적고 퇴장 판정을 다시 맞춘다. 같은 채널에 또 켜면 already", async () => {
  const { bot, seen } = seated({ id: "vc1", name: "음성", type: ChannelType.GuildVoice });
  assert.deepEqual(await stay.turnOn(bot, { guild, member: member() }), { ok: true, kind: "on", channelId: "vc1", already: false });
  assert.equal(staySeats.seatOf("g1")?.channelId, "vc1");
  assert.equal(staySeats.seatOf("g1")?.setBy, "u1");
  assert.deepEqual(await stay.turnOn(bot, { guild, member: member() }), { ok: true, kind: "on", channelId: "vc1", already: true });
  assert.equal(seen.reconsider, 2);
});

test("켜기 거절: 서버 관리 권한이 없으면 · 스테이지면 · 운영자가 껐으면", async () => {
  const voice = seated({ id: "vc1", name: "음성", type: ChannelType.GuildVoice });
  assert.deepEqual(await stay.turnOn(voice.bot, { guild, member: member(false) }), { ok: false, code: "must-moderator" });
  const stage = seated({ id: "st1", name: "무대", type: ChannelType.GuildStageVoice });
  assert.deepEqual(await stay.turnOn(stage.bot, { guild, member: member() }), { ok: false, code: "stay-stage" });
  await withConfig({ bot: { stayEnabled: false } }, async () => assert.deepEqual(await stay.turnOn(voice.bot, { guild, member: member() }), { ok: false, code: "stay-disabled" }));
  assert.equal(staySeats.seatOf("g1"), null);
});

test("끄기: 자리를 지우고 다시 맞춘다. 없으면 already, 권한이 없으면 거절", async () => {
  const { bot, seen } = seated({ id: "vc1", name: "음성", type: ChannelType.GuildVoice });
  staySeats.set("g1", "vc1", "u1");
  assert.deepEqual(stay.turnOff(bot, { guild, member: member(false) }), { ok: false, code: "must-moderator" });
  assert.deepEqual(stay.turnOff(bot, { guild, member: member() }), { ok: true, kind: "off", already: false });
  assert.equal(staySeats.seatOf("g1"), null);
  assert.equal(seen.reconsider, 1);
  assert.deepEqual(stay.turnOff(bot, { guild, member: member() }), { ok: true, kind: "off", already: true });
});
