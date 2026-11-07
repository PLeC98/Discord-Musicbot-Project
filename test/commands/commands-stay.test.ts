// src/discord/commands/247.ts: 켜기는 음성 채널에 접속하느라 몇 초 걸려 응답을 보류(defer)하는데, 거절 안내가 채널에 보이지 않게 본인에게만 보이도록 보류한다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { command, run } from "../helpers/commands.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { fakeBot } from "../helpers/fake.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";

const store = openTempStore("commands-stay-");
after(() => store.close());

test("/247 켜기: 본인에게만 보이도록 응답을 보류해 두고, DJ가 아니면 본인에게만 보이는 안내로 바꾼다(채널에 대기 표시가 보이지 않는다)", async () => {
  // DJ 역할(r1)을 지정한 서버다. 봇은 vc1에 있고 부른 사람은 역할 없이 vc1에 있다
  const guild = { id: "g1", name: "서버", roles: { cache: new Map([["r1", {}]]) }, members: { me: { voice: { channel: { id: "vc1" } } } } };
  const member = { id: "u2", user: { tag: "다른 사람" }, guild, permissions: { has: () => false }, roles: { cache: new Map() }, voice: { channel: { id: "vc1" } } };
  await guildSettings.setDjRoles("g1", ["r1"]);
  const log: Array<[string, unknown]> = [];
  const it = {
    guild,
    member,
    channel: { id: "c1" },
    replied: false,
    deferred: false,
    deferReply: async (payload?: unknown) => {
      it.deferred = true;
      log.push(["deferReply", payload]);
    },
    deleteReply: async () => log.push(["deleteReply", null]),
    followUp: async (payload: unknown) => (log.push(["followUp", payload]), { id: "m1" }),
  };
  try {
    await run(await command("247"), it, fakeBot());
  } finally {
    await guildSettings.setDjRoles("g1", []);
  }
  assert.deepEqual(log[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
  assert.deepEqual(
    log.map(([name]) => name),
    ["deferReply", "deleteReply", "followUp"],
  );
});
