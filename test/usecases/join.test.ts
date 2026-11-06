// src/usecases/join.ts: 봇 부르기. 기다림(기동 복원, 채널 찾기) 뒤 그만두면(대시보드의 세션 끝) 아무것도 바꾸지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Guild, GuildMember, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import { fake } from "../helpers/fake.ts";

const { join } = await import("../../src/usecases/join.ts");

test("그만두면(go 가 던짐) 남은 플레이어를 정리하지도 새로 만들지도 않는다", async () => {
  const channel = fake<VoiceBasedChannel>({ id: "v1", permissionsFor: () => ({ has: () => true }) });
  const guild = fake<Guild>({ id: "g-join", members: { me: { voice: { channel: null } } }, channels: { cache: new Map() } });
  const member = fake<GuildMember>({ id: "u1", voice: { channel } });
  const existing = fake<Player>({ voice: { isAlive: () => false }, dispose: () => assert.fail("정리하지 않는다") });
  const players = new Map<string, Player>([["g-join", existing]]);
  const ended = () => {
    throw new Error("세션이 끝났다");
  };
  await assert.rejects(join({ players }, { guild, member, textChannel: fake<GuildTextBasedChannel>({ id: "t1" }) }, { go: ended }), /세션이 끝났다/);
  assert.equal(players.get("g-join"), existing, "그대로");
});
