// src/discord/commands/normalize.ts: 볼륨 정규화 켜기, 끄기(usecases/normalize). 동작을 비우면 지금 상태를 본인에게만 보여 준다(누구나).
// 바꾸는 것은 DJ 조작이다(봇이 음성 채널에 있으면 같은 채널). 봇이 음성 채널에 없어도 바꿀 수 있고, 바꾼 결과는 모두에게 보인다

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { command, run } from "../helpers/commands.ts";
import { openTempStore, whenSettingsBroken } from "../helpers/temp-store.ts";
import { fakeBot } from "../helpers/fake.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";

const store = openTempStore("commands-normalize-");
after(() => store.close());

type Sent = { content?: string; flags?: readonly number[]; components?: unknown[] };

// 봇이 botChannel 에 있다(null 이면 음성 채널 밖). 실행한 사람은 voiceChannel 에 있고 roles 역할이 있다
function call(action: string | null, { botChannel = null, voiceChannel = null, roles = [] }: { botChannel?: string | null; voiceChannel?: string | null; roles?: string[] } = {}) {
  const guild = { id: "g1", name: "서버", roles: { cache: new Map([["r1", {}]]) }, members: { me: { voice: { channel: botChannel ? { id: botChannel } : null } } } };
  const member = { id: "u2", user: { tag: "실행한 사람" }, guild, permissions: { has: () => false }, roles: { cache: new Map(roles.map((id) => [id, {}])) }, voice: { channel: voiceChannel ? { id: voiceChannel } : null } };
  const sent: Sent[] = [];
  const it = {
    guild,
    member,
    channel: { id: "c1" },
    replied: false,
    deferred: false,
    options: { getString: () => action },
    isChatInputCommand: () => true,
    reply: async (payload: Sent) => {
      it.replied = true;
      sent.push(payload);
      return { resource: null };
    },
    deleteReply: async () => {},
    followUp: async (payload: Sent) => (sent.push(payload), { id: "m1" }),
  };
  return { it, sent };
}

const textOf = (payload: Sent | undefined) => JSON.stringify(payload);
const ephemeral = (payload: Sent | undefined) => Boolean(payload?.flags?.includes(MessageFlags.Ephemeral));

beforeEach(async () => {
  await guildSettings.setNormalize("g1", false);
  await guildSettings.setDjRoles("g1", []);
});

test("/normalize: 동작을 비우면 지금 상태를 본인에게만 보여 준다(DJ 가 아니어도)", async () => {
  await guildSettings.setDjRoles("g1", ["r1"]);
  await guildSettings.setNormalize("g1", true);
  const { it, sent } = call(null);
  await run(await command("normalize"), it, fakeBot());
  assert.equal(sent.length, 1);
  assert.ok(ephemeral(sent[0]));
  assert.match(textOf(sent[0]), /볼륨 정규화가 켜져 있어요/);
});

test("/normalize: 봇이 음성 채널에 없어도 DJ 가 켜고 끌 수 있고, 결과는 모두에게 보인다", async () => {
  const on = call("on");
  await run(await command("normalize"), on.it, fakeBot());
  assert.equal(guildSettings.resolveNormalize("g1"), true);
  assert.ok(!ephemeral(on.sent[0]));
  assert.match(textOf(on.sent[0]), /볼륨 정규화를 켰어요/);

  const again = call("on");
  await run(await command("normalize"), again.it, fakeBot());
  assert.match(textOf(again.sent[0]), /이미 볼륨 정규화가 켜져 있어요/);

  const off = call("off");
  await run(await command("normalize"), off.it, fakeBot());
  assert.equal(guildSettings.resolveNormalize("g1"), false);
  assert.match(textOf(off.sent[0]), /볼륨 정규화를 껐어요/);
});

test("/normalize: DJ 가 아니거나 봇과 다른 음성 채널이면 바꾸지 않고 본인에게만 알린다", async () => {
  await guildSettings.setDjRoles("g1", ["r1"]);
  const user = call("on");
  await run(await command("normalize"), user.it, fakeBot());
  assert.ok(ephemeral(user.sent[0]));
  assert.equal(guildSettings.resolveNormalize("g1"), false);

  const elsewhere = call("on", { botChannel: "vc1", voiceChannel: "vc2", roles: ["r1"] });
  await run(await command("normalize"), elsewhere.it, fakeBot());
  assert.ok(ephemeral(elsewhere.sent[0]));
  assert.equal(guildSettings.resolveNormalize("g1"), false);

  const same = call("on", { botChannel: "vc1", voiceChannel: "vc1", roles: ["r1"] });
  await run(await command("normalize"), same.it, fakeBot());
  assert.equal(guildSettings.resolveNormalize("g1"), true);
});

test("/normalize: 저장에 실패하면 바꾸지 않고 본인에게만 실패를 알린다", async () => {
  const { it, sent } = call("on");
  await whenSettingsBroken(async () => run(await command("normalize"), it, fakeBot()));
  assert.ok(ephemeral(sent.at(-1)));
  assert.match(textOf(sent.at(-1)), /설정을 저장하지 못했어요/);
  assert.equal(guildSettings.table.getNormalize("g1"), false);
});

test("/normalize: 읽기 실패로 끔이 캐시에 남아도 끄기는 저장된 켬을 끈다(이미 그 상태인지는 저장소가 행을 보고 정한다)", async () => {
  await guildSettings.setNormalize("g1", true);
  guildSettings.forgetCache();
  await whenSettingsBroken(() => guildSettings.resolveNormalize("g1"));
  assert.equal(guildSettings.resolveNormalize("g1"), false, "읽기 실패로 기억한 끔");
  const { it, sent } = call("off");
  await run(await command("normalize"), it, fakeBot());
  assert.match(textOf(sent[0]), /볼륨 정규화를 껐어요/);
  assert.equal(guildSettings.table.getNormalize("g1"), false);
});
