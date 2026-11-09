// src/player/voice-adopt.ts: 세션 없이 음성 채널에 남은 봇을 기동 시 이어받는다.
// 가짜 서버, 플레이어로 어느 서버에 무엇을 했는지만 본다.

import { test, after } from "node:test";
import { beginShutdown, _resetShutdown } from "../../src/infra/shutdown-state.ts";
import assert from "node:assert/strict";
import { Status, type Client } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import { adoptLingeringVoice } from "../../src/player/voice-adopt.ts";
import { restoreSessions } from "../../src/player/session-restore.ts";
import { fake } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { sessions } from "../../src/store/player-sessions.ts";

const store = openTempStore("voice-adopt-");
after(() => store.close());

const BOT = "bot1";

// 서버 하나. botIn: 봇이 앉아 있는 음성 채널(없으면 null), humans: 그 채널의 사람 수
function guildWith(id: string, { botIn = "vc1" as string | null, humans = 1 } = {}) {
  const members = new Map<string, { user: { bot: boolean } }>([[BOT, { user: { bot: true } }]]);
  for (let i = 0; i < humans; i++) members.set(`u${i}`, { user: { bot: false } });
  const channel = { id: botIn, name: `채널-${id}`, isVoiceBased: () => true, members: Object.assign(members, { filter: (fn: (m: { user: { bot: boolean } }) => boolean) => ({ size: [...members.values()].filter(fn).length }) }) };
  const voiceStates = new Map(botIn ? [[BOT, { channel }]] : []);
  // 나가기(voice-leave): 샤드가 끊겨 있어 REST 로 뺀다. 뺀 횟수를 left 에
  const left: string[] = [];
  return {
    id,
    name: `서버-${id}`,
    left,
    shard: { status: Status.Disconnected },
    voiceStates: { cache: voiceStates, fetch: async () => ({ channelId: botIn }) },
    members: { me: { voice: { channel: botIn ? channel : null, channelId: botIn, disconnect: async () => void left.push("rest") } } },
  };
}

function world(guilds: ReturnType<typeof guildWith>[], { failConnect = [] as string[] } = {}) {
  const steps: string[] = [];
  const players = new Map<string, Player>();
  class FakePlayer {
    guild: { id: string };
    voice: { connect(): Promise<boolean> };
    idle = { scheduleEmpty: (why: string) => steps.push(`${this.guild.id}:empty:${why}`), announce: () => steps.push(`${this.guild.id}:announce`) };
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
    showIdleVoiceStatus() {
      steps.push(`${this.guild.id}:status:idle`);
    }
    async dispose(o: { session: string }) {
      steps.push(`${this.guild.id}:dispose:${o.session}`);
    }
  }
  const client = fake<Client<true>>({ user: { id: BOT }, guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } });
  return { client, players, steps, FakePlayer: FakePlayer as unknown as Parameters<typeof adoptLingeringVoice>[2] };
}

test("봇이 음성 채널에 남아 있고 플레이어가 없는 서버만 이어받는다: 붙고, 쉬는 문구를 걸고, 틀 게 없음 퇴장을 건다", async () => {
  const restored = guildWith("g2");
  const { client, players, steps, FakePlayer } = world([guildWith("g1"), restored, guildWith("g3", { botIn: null })]);
  const restoredPlayer = fake<Player>({ name: "세션을 복원한 플레이어" });
  players.set("g2", restoredPlayer);
  await adoptLingeringVoice(client, players, FakePlayer);
  assert.deepEqual(steps, ["g1:new:null:vc1", "g1:connect", "g1:status:idle", "g1:empty:곡 없이 대기", "g1:announce"]);
  assert.ok(players.has("g1"));
  assert.equal(players.get("g2"), restoredPlayer);
  assert.equal(players.has("g3"), false);
});

test("혼자 남음은 붙을 때(connect) 억제 사유를 맞추며 이미 걸었다. 틀 게 없음 퇴장을 건 뒤 나갈 시각을 한 번 더 알린다", async () => {
  const { client, players, steps, FakePlayer } = world([guildWith("g1", { humans: 0 })]);
  await adoptLingeringVoice(client, players, FakePlayer);
  assert.deepEqual(steps.slice(-2), ["g1:empty:곡 없이 대기", "g1:announce"]);
});

test("재연결하지 못하면 그 서버는 정리하고(세션은 남김) 다음 서버로 넘어간다", async () => {
  const { client, players, steps, FakePlayer } = world([guildWith("g1"), guildWith("g2")], { failConnect: ["g1"] });
  await adoptLingeringVoice(client, players, FakePlayer);
  assert.deepEqual(steps.slice(0, 2), ["g1:new:null:vc1", "g1:dispose:keep"]);
  assert.ok(steps.includes("g2:connect"));
});

test("복원을 건너뛴 기동: 저장된 세션이 있는 서버는 이어받지 않고 음성 채널에서 나간다. 세션은 건드리지 않아 /join이 이어 튼다", async () => {
  sessions().saveSession("g1", { voiceChannelId: "vc1", textChannelId: "t1", volume: 100, loopMode: "off", autoplay: null, userPaused: false, positionMs: 0 });
  try {
    const saved = guildWith("g1");
    const fresh = guildWith("g2");
    const { client, players, steps, FakePlayer } = world([saved, fresh]);
    // 기동과 같은 차례로: 복원(건너뜀)이 돌려준 서버를 이어받기에 넘긴다
    const touched = await restoreSessions(client, players, FakePlayer, { skip: true });
    await adoptLingeringVoice(client, players, FakePlayer, { touched });
    assert.ok(!steps.some((s) => s.startsWith("g1:")), "플레이어를 만들지 않는다");
    assert.deepEqual(saved.left, ["rest"], "음성 채널에서 나간다");
    assert.deepEqual(fresh.left, [], "세션이 없는 서버는 이어받는다(나가지 않는다)");
    assert.ok(steps.includes("g2:connect"));
    assert.equal(players.has("g1"), false);
    assert.ok(sessions().load("g1"), "세션은 그대로");
  } finally {
    sessions().removeSession("g1");
  }
});

test("이번 기동에 세션 복원이 손댄 서버(복원하다 실패해 세션을 삭제하고 나감)는 캐시에 봇이 남아 보여도 이어받지 않는다", async () => {
  // 세션이 남아 있어도(복원이 다시 저장했다) 손대지 않는다
  sessions().saveSession("g1", { voiceChannelId: "vc1", textChannelId: "t1", volume: 100, loopMode: "off", autoplay: null, userPaused: false, positionMs: 0 });
  try {
    const restored = guildWith("g1");
    const { client, players, steps, FakePlayer } = world([restored, guildWith("g2")]);
    await adoptLingeringVoice(client, players, FakePlayer, { touched: ["g1"] });
    assert.ok(!steps.some((s) => s.startsWith("g1:")));
    assert.deepEqual(restored.left, [], "나가기도 보내지 않는다(넘겨받기 참가가 나간 봇을 다시 들여보내지 않게)");
    assert.ok(steps.includes("g2:connect"));
  } finally {
    sessions().removeSession("g1");
  }
});

test("종료 중이면 이어받지 않는다(플레이어를 만들지 않는다)", async (t) => {
  t.after(() => _resetShutdown());
  const { client, players, steps, FakePlayer } = world([guildWith("g1")]);
  beginShutdown();
  await adoptLingeringVoice(client, players, FakePlayer);
  assert.deepEqual(steps, []);
  assert.equal(players.has("g1"), false);
});
