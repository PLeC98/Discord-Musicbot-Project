// src/player/voice-leave.ts: 플레이어 없이 음성 채널에만 남은 봇을 뺀다.
// 가짜 서버(helpers/lingering-guild)로 무엇을 어떤 차례로 보냈는지 본다

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { leaveLingeringVoice } from "../../src/player/voice-leave.ts";
import { lingeringGuild } from "../helpers/lingering-guild.ts";
import type { Player } from "../../src/player/player.ts";

const none = new Map<string, Player>();
const FLAGS = { self_deaf: true, self_mute: false };
const ASKED = "fetch:@me:true:false"; // 캐시를 거치지 않고 디스코드에 묻는다

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};
// 알림을 흘려보내고 1.5초씩 times 번 넘긴다
async function settle<T>(t: TestContext, work: Promise<T>, times: number) {
  for (let i = 0; i < times; i++) {
    await flush();
    t.mock.timers.tick(1500);
  }
  return work;
}

test("디스코드에 지금 채널을 묻고, 그 채널 참가로 음성 상태를 넘겨받은 뒤 나간다(게이트웨이). REST 는 부르지 않고 리스너를 뗀다", async () => {
  const { guild, client, sent, order, rests } = lingeringGuild();
  assert.equal(await leaveLingeringVoice(guild, none), "gateway");
  assert.deepEqual(order, [ASKED, "op4:vc1", "op4:null"]);
  assert.deepEqual(sent, [
    { op: 4, d: { guild_id: "g9", channel_id: "vc1", ...FLAGS } },
    { op: 4, d: { guild_id: "g9", channel_id: null, ...FLAGS } },
  ]);
  assert.equal(rests(), 0);
  assert.equal(client.listenerCount("voiceStateUpdate"), 0);
});

test("넘겨받기는 디스코드가 아는 채널로 보낸다(캐시는 끊긴 동안 낡는다). 묻지 못하면 캐시의 채널로", async () => {
  const moved = lingeringGuild({ atDiscord: "vc2" });
  assert.equal(await leaveLingeringVoice(moved.guild, none), "gateway");
  assert.equal(moved.sent[0]?.d.channel_id, "vc2");

  const unknown = lingeringGuild({ atDiscord: new Error("Service Unavailable") });
  assert.equal(await leaveLingeringVoice(unknown.guild, none), "gateway");
  assert.equal(unknown.sent[0]?.d.channel_id, "vc1");
});

test("디스코드가 봇이 음성에 없다고 하면(10065) 아무것도 보내지 않는다. 넘겨받기 참가가 봇을 다시 들여보내지 않게", async () => {
  const { guild, order } = lingeringGuild({ atDiscord: null });
  assert.equal(await leaveLingeringVoice(guild, none), "already");
  assert.deepEqual(order, [ASKED]);
});

test("넘겨받기에 알림이 없어도 1.5초 뒤 나가기를 보내 본다. 나가기도 1.5초 안에 먹히지 않으면 REST 로 뺀다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { guild, client, order } = lingeringGuild({ takeOver: false });
  const leaving = leaveLingeringVoice(guild, none);
  await flush();
  t.mock.timers.tick(1499);
  await flush();
  assert.deepEqual(order, [ASKED, "op4:vc1"], "1.5초 전에는 다음으로 가지 않는다");
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(order, [ASKED, "op4:vc1", "op4:null"]);
  t.mock.timers.tick(1500);
  assert.equal(await leaving, "rest");
  assert.deepEqual(order, [ASKED, "op4:vc1", "op4:null", "rest"]);
  assert.equal(client.listenerCount("voiceStateUpdate"), 0);
});

test("넘겨받았는데 나가기가 먹히지 않으면 REST. 40032(이미 음성에 없음)는 나간 것, 그 밖의 실패는 failed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stuck = lingeringGuild({ gatewayLeaves: false });
  assert.equal(await settle(t, leaveLingeringVoice(stuck.guild, none), 1), "rest");
  assert.deepEqual(stuck.order, [ASKED, "op4:vc1", "op4:null", "rest"]);

  const gone = lingeringGuild({ gatewayLeaves: false, restError: Object.assign(new Error("Target user is not connected to voice"), { code: 40032 }) });
  assert.equal(await settle(t, leaveLingeringVoice(gone.guild, none), 1), "already");

  const denied = lingeringGuild({ gatewayLeaves: false, restError: Object.assign(new Error("Missing Permissions"), { code: 50013 }) });
  assert.equal(await settle(t, leaveLingeringVoice(denied.guild, none), 1), "failed");
});

test("샤드가 준비되지 않았으면 게이트웨이로 보내지 않고 REST 로 뺀다. 캐시에 채널이 없어도 디스코드가 있다고 했으면 뺀다", async () => {
  const { guild, order } = lingeringGuild({ ready: false });
  assert.equal(await leaveLingeringVoice(guild, none), "rest");
  assert.deepEqual(order, [ASKED, "rest"]);

  const stale = lingeringGuild({ ready: false, cached: null });
  assert.equal(await leaveLingeringVoice(stale.guild, none), "rest");
  assert.deepEqual(stale.order, [ASKED, "rest"]);
});

test("플레이어가 있으면(누가 다시 불렀다) 새로 붙은 연결을 쫓아내지 않는다", async (t) => {
  const early = lingeringGuild();
  assert.equal(await leaveLingeringVoice(early.guild, new Map([["g9", {} as Player]])), "superseded");
  assert.deepEqual(early.order, [ASKED], "처음부터 있으면 아무것도 보내지 않는다");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const whileTaking = lingeringGuild({ takeOver: false });
  const seats = new Map<string, Player>();
  const taking = leaveLingeringVoice(whileTaking.guild, seats);
  await flush();
  seats.set("g9", {} as Player);
  t.mock.timers.tick(1500);
  assert.equal(await taking, "superseded");
  assert.deepEqual(whileTaking.order, [ASKED, "op4:vc1"], "넘겨받는 사이 생기면 나가기를 보내지 않는다");

  const whileLeaving = lingeringGuild({ gatewayLeaves: false });
  const later = new Map<string, Player>();
  const leaving = leaveLingeringVoice(whileLeaving.guild, later);
  await flush();
  later.set("g9", {} as Player);
  t.mock.timers.tick(1500);
  assert.equal(await leaving, "superseded");
  assert.deepEqual(whileLeaving.order, [ASKED, "op4:vc1", "op4:null"], "나가는 사이 생기면 REST 로 빼지 않는다");
  assert.equal(whileLeaving.client.listenerCount("voiceStateUpdate"), 0);
});
