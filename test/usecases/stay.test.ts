// src/usecases/stay.ts: 24/7 켜기, 끄기. 자리는 봇이 있는 채널(없으면 부른 사람의 채널에 붙은 뒤), 스테이지는 받지 않는다

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, type Guild, type GuildMember } from "discord.js";
import * as stay from "../../src/usecases/stay.ts";
import * as staySeats from "../../src/store/stay-seats.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { fake } from "../helpers/fake.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";
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

// DJ 역할(r1)을 정한 서버에서 봇이 vc1에 있다. roles는 사용자의 역할, channel은 사용자의 음성 채널이다.
function djServer() {
  const withRoles = fake<Guild>({ id: "g1", name: "서버", roles: { cache: new Map([["r1", {}]]) }, members: { me: { voice: { channel: { id: "vc1" } } } } });
  return (roles: string[], channel: string | null) => fake<GuildMember>({ id: "u2", user: { tag: "다른 사람" }, guild: withRoles, permissions: { has: () => false }, roles: { cache: new Map(roles.map((id) => [id, {}])) }, voice: { channel: channel ? { id: channel } : null } });
}

test("켜기, 끄기는 DJ 조작이다: 서버 관리 권한이 없어도 DJ면 되고, DJ가 아니거나 봇과 다른 채널이면 거절한다", async () => {
  const voice = seated({ id: "vc1", name: "음성", type: ChannelType.GuildVoice });
  const someone = djServer();
  assert.equal((await stay.turnOn(voice.bot, { guild, member: someone([], "vc1") })).ok, true, "DJ 역할을 정하지 않은 서버는 모두 DJ");
  staySeats.clear("g1");
  await guildSettings.setDjRoles("g1", ["r1"]);
  try {
    assert.deepEqual(await stay.turnOn(voice.bot, { guild, member: someone([], "vc1") }), { ok: false, code: "must-dj" });
    assert.deepEqual(await stay.turnOn(voice.bot, { guild, member: someone(["r1"], "vc2") }), { ok: false, code: "must-be-in-same-voice" });
    assert.deepEqual(await stay.turnOn(voice.bot, { guild, member: someone(["r1"], "vc1") }), { ok: true, kind: "on", channelId: "vc1", already: false });
    assert.deepEqual(await stay.turnOff(voice.bot, { guild, member: someone([], "vc1") }), { ok: false, code: "must-dj" });
    assert.deepEqual(await stay.turnOff(voice.bot, { guild, member: someone(["r1"], "vc1") }), { ok: true, kind: "off", already: false });
  } finally {
    await guildSettings.setDjRoles("g1", []);
  }
});

test("켜기 거절: 스테이지 채널이면 거절한다", async () => {
  const stage = seated({ id: "st1", name: "무대", type: ChannelType.GuildStageVoice });
  assert.deepEqual(await stay.turnOn(stage.bot, { guild, member: member() }), { ok: false, code: "stay-stage" });
  assert.equal(staySeats.seatOf("g1"), null);
});

test("끄기: 상주 설정을 삭제하고 퇴장 여부를 다시 판단한다. 켜져 있지 않았으면 already", async () => {
  const { bot, seen } = seated({ id: "vc1", name: "음성", type: ChannelType.GuildVoice });
  staySeats.set("g1", "vc1", "u1");
  assert.deepEqual(await stay.turnOff(bot, { guild, member: member() }), { ok: true, kind: "off", already: false });
  assert.equal(staySeats.seatOf("g1"), null);
  assert.equal(seen.reconsider, 1);
  assert.deepEqual(await stay.turnOff(bot, { guild, member: member() }), { ok: true, kind: "off", already: true });
});
