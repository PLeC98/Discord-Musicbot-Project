// src/player/voice-adopt.ts — 세션 없이 음성 채널에 남은 봇을 기동 때 이어받는다.
// 가짜 서버 · 플레이어로 어느 서버에 무엇을 했는지만 본다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { adoptLingeringVoice } from "../../src/player/voice-adopt.ts";
import config from "../../src/config/index.ts";
import { fake } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { sessions } from "../../src/store/player-sessions.ts";

const store = openTempStore("voice-adopt-");
after(() => store.close());

const BOT = "bot1";

// 서버 하나. botIn: 봇이 앉아 있는 음성 채널(없으면 null) · humans: 그 채널의 사람 수
function guildWith(id: string, { botIn = "vc1" as string | null, humans = 1 } = {}) {
  const members = new Map<string, { user: { bot: boolean } }>([[BOT, { user: { bot: true } }]]);
  for (let i = 0; i < humans; i++) members.set(`u${i}`, { user: { bot: false } });
  const channel = { id: botIn, name: `채널-${id}`, isVoiceBased: () => true, members: Object.assign(members, { filter: (fn: (m: { user: { bot: boolean } }) => boolean) => ({ size: [...members.values()].filter(fn).length }) }) };
  const voiceStates = new Map(botIn ? [[BOT, { channel }]] : []);
  return { id, name: `서버-${id}`, voiceStates: { cache: voiceStates } };
}

function world(guilds: ReturnType<typeof guildWith>[], { failConnect = [] as string[] } = {}) {
  const steps: string[] = [];
  const players = new Map<string, unknown>();
  class FakePlayer {
    guild: { id: string };
    voice: { connect(): Promise<boolean> };
    idle = { scheduleEmpty: (why: string) => steps.push(`${this.guild.id}:empty:${why}`), startAlone: () => steps.push(`${this.guild.id}:alone`) };
    constructor(guild: { id: string }, text: unknown, voice: { id: string }) {
      this.guild = guild;
      steps.push(`${guild.id}:new:${String(text)}:${voice.id}`);
      this.voice = {
        connect: async () => {
          if (failConnect.includes(guild.id)) throw new Error("Ready 안 옴");
          steps.push(`${guild.id}:connect`);
          return true;
        },
      };
    }
    async updateVoiceStatus(text: string) {
      steps.push(`${this.guild.id}:status:${text}`);
    }
    async dispose(o: { session: string }) {
      steps.push(`${this.guild.id}:dispose:${o.session}`);
    }
  }
  const client = fake<Client<true>>({ user: { id: BOT }, players, guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } });
  return { client, players, steps, FakePlayer: FakePlayer as unknown as Parameters<typeof adoptLingeringVoice>[1] };
}

test("봇이 음성 채널에 남아 있고 플레이어가 없는 서버만 이어받는다: 붙고, 쉬는 문구를 걸고, 틀 게 없음 퇴장을 건다", async () => {
  const restored = guildWith("g2");
  const { client, players, steps, FakePlayer } = world([guildWith("g1"), restored, guildWith("g3", { botIn: null })]);
  players.set("g2", "세션을 되살린 플레이어");
  await adoptLingeringVoice(client, FakePlayer);
  assert.deepEqual(steps, ["g1:new:null:vc1", "g1:connect", `g1:status:${config.voiceStatus.idleText}`, "g1:empty:곡 없이 대기"]);
  assert.ok(players.has("g1"));
  assert.equal(players.get("g2"), "세션을 되살린 플레이어");
  assert.equal(players.has("g3"), false);
});

test("그 채널에 사람이 없으면 혼자 남음 퇴장도 건다", async () => {
  const { client, steps, FakePlayer } = world([guildWith("g1", { humans: 0 })]);
  await adoptLingeringVoice(client, FakePlayer);
  assert.deepEqual(steps.slice(-2), ["g1:empty:곡 없이 대기", "g1:alone"]);
});

test("다시 붙지 못하면 그 서버는 정리하고(세션은 남김) 다음 서버로 넘어간다", async () => {
  const { client, steps, FakePlayer } = world([guildWith("g1"), guildWith("g2")], { failConnect: ["g1"] });
  await adoptLingeringVoice(client, FakePlayer);
  assert.deepEqual(steps.slice(0, 2), ["g1:new:null:vc1", "g1:dispose:keep"]);
  assert.ok(steps.includes("g2:connect"));
});

test("저장된 세션이 있는 서버(이번에 되살리지 않았다)는 이어받지 않고 세션도 건드리지 않는다. /join 이 이어 튼다", async () => {
  sessions().saveSession("g1", { voiceChannelId: "vc1", textChannelId: "t1", volume: 100, loopMode: "off", autoplay: null, pausedManual: false, positionMs: 0, startOffsetMs: 0, requesterId: null });
  try {
    const { client, players, steps, FakePlayer } = world([guildWith("g1")]);
    await adoptLingeringVoice(client, FakePlayer);
    assert.deepEqual(steps, []);
    assert.equal(players.has("g1"), false);
    assert.ok(sessions().load("g1"), "세션은 그대로");
  } finally {
    sessions().removeSession("g1");
  }
});

test("이번 기동에 세션 복원이 손댄 서버(복원하다 실패해 세션을 지우고 나감)는 캐시에 봇이 남아 보여도 이어받지 않는다", async () => {
  const { client, steps, FakePlayer } = world([guildWith("g1"), guildWith("g2")]);
  await adoptLingeringVoice(client, FakePlayer, { touched: ["g1"] });
  assert.ok(!steps.some((s) => s.startsWith("g1:")));
  assert.ok(steps.includes("g2:connect"));
});
