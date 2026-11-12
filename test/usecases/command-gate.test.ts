// src/usecases/command-gate.ts: /help 명령: 의 "지금은". 실행 때 쓰는 확인이 권한 등급의 기본과 다른 명령은 모듈이 gate 로 적고, 나머지는 등급의 기본 확인을 쓴다.
// 서버 설정(DJ 역할)은 진짜를 임시 DB 로 쓴다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits, type GuildMember } from "discord.js";
import { fake } from "../helpers/fake.ts";
import { withConfig } from "../helpers/config.ts";
import { openTempStore, setGuild } from "../helpers/temp-store.ts";
const store = openTempStore("gate-");
after(() => store.close());

const { gateOf, BY_TIER } = await import("../../src/usecases/command-gate.ts");
const { COMMANDS } = await import("../../src/discord/commands/index.ts");

type MemberOptions = { id?: string; perms?: bigint[]; roles?: string[]; voice?: string | null; botVoice?: string | null };
function fakeMember({ id = "u0", perms = [], roles = [], voice = null, botVoice = null }: MemberOptions = {}) {
  return fake<GuildMember>({
    id,
    permissions: { has: (p: bigint) => perms.includes(p) },
    guild: { id: "g", roles: { cache: { has: () => true } }, members: { me: { voice: { channel: botVoice ? { id: botVoice } : null } } } },
    roles: { cache: { has: (role: string) => roles.includes(role) } },
    voice: { channel: voice ? { id: voice, permissionsFor: () => ({ has: () => true }) } : null },
  });
}
const context = (over: Partial<{ player: { currentTrack?: { requestedBy: { id: string } } | null }; botChannelId: string | null; channelId: string }> = {}) => ({ player: undefined, botChannelId: null, channelId: "c1", ...over });

test("실행 때의 확인이 등급의 기본과 다른 명령만 gate 를 적는다(곡 추가, 우선 추가, 검색, 자동재생, 부르기, 건너뛰기, 상주 모드)", () => {
  const declared = COMMANDS.filter((command) => command.help?.gate).map((command) => command.data.name);
  assert.deepEqual(declared.sort(), ["247", "autoplay", "join", "play", "playfirst", "search", "skip"]);
  for (const command of COMMANDS) if (command.help) assert.equal(typeof gateOf(command.help), "function", command.data.name);
});

test("등급의 기본: 누구나는 늘 됨, 서버 관리자, 봇 운영자는 그 권한", async () => {
  assert.equal(await BY_TIER.everyone(fakeMember(), context()), null);
  assert.equal(await BY_TIER["server-manager"](fakeMember(), context()), "must-server-manager");
  assert.equal(await BY_TIER["server-manager"](fakeMember({ perms: [PermissionFlagsBits.ManageGuild] }), context()), null);
  await withConfig({ dashboard: { ownerId: "boss" } }, async () => {
    assert.equal(await BY_TIER.owner(fakeMember({ id: "u0" }), context()), "must-owner");
    assert.equal(await BY_TIER.owner(fakeMember({ id: "boss" }), context()), null);
  });
});

test("DJ 조작: DJ 가 아니면 must-dj, 다른 음성 채널이면 그 까닭. 자기 곡도 되는 명령은 DJ 가 아니면 own-track", async () => {
  setGuild("g", { djRoles: ["dj"] });
  assert.equal(await BY_TIER.dj(fakeMember({ roles: ["dj"] }), context()), null);
  assert.equal(await BY_TIER.dj(fakeMember(), context()), "must-dj");
  assert.equal(await BY_TIER.dj(fakeMember({ roles: ["dj"], voice: "v1", botVoice: "v2" }), context()), "must-be-in-same-voice");
  assert.equal(await BY_TIER["dj-or-requester"](fakeMember(), context()), "own-track");
  assert.equal(await BY_TIER["dj-or-requester"](fakeMember({ voice: "v1", botVoice: "v2" }), context()), "must-be-in-same-voice");
  setGuild("g", { djRoles: [] });
});

test("전용 채널이 있으면 그 채널에서만, 없으면 DJ 조작", async () => {
  setGuild("g", { djRoles: ["dj"] });
  const gate = BY_TIER["dj-outside-bot-channel"];
  assert.equal(await gate(fakeMember(), context({ botChannelId: "bot", channelId: "bot" })), null);
  assert.equal(await gate(fakeMember(), context({ botChannelId: "bot", channelId: "other" })), "only-in-bot-channel");
  assert.equal(await gate(fakeMember(), context()), "must-dj");
  setGuild("g", { djRoles: [] });
});

test("/skip 은 실행과 같은 checkSkip: 지금 곡을 넣은 사람이면 DJ 가 아니어도 된다", async () => {
  setGuild("g", { djRoles: ["dj"] });
  const skip = COMMANDS.find((command) => command.data.name === "skip")!;
  const gate = gateOf(skip.help!);
  assert.equal(await gate(fakeMember({ id: "me" }), context({ player: { currentTrack: { requestedBy: { id: "me" } } } })), null);
  assert.equal(await gate(fakeMember({ id: "me" }), context({ player: { currentTrack: { requestedBy: { id: "other" } } } })), "must-dj");
  setGuild("g", { djRoles: [] });
});

test("/play 는 실행과 같은 곡 추가 확인: 봇이 쉬면 음성 채널에 있어야 한다", async () => {
  const play = COMMANDS.find((command) => command.data.name === "play")!;
  assert.equal(await gateOf(play.help!)(fakeMember(), context()), "must-be-in-voice");
  assert.equal(await gateOf(play.help!)(fakeMember({ voice: "v1" }), context()), null);
});

test("/247 은 실행과 같은 확인: 켜져 있으면 끄기라 DJ 조작만, 꺼져 있으면 켜기라 봇이 쉬면 음성 채널에 있어야 하고 스테이지는 안 된다", async () => {
  const staySeats = await import("../../src/store/stay-seats.ts");
  const stay = COMMANDS.find((command) => command.data.name === "247")!;
  const gate = gateOf(stay.help!);
  assert.equal(await gate(fakeMember(), context()), "must-be-in-voice", "꺼져 있고 봇이 쉬는데 음성 채널 밖");
  assert.equal(await gate(fakeMember({ voice: "v1" }), context()), null);
  const onStage = fakeMember({ voice: "v1" });
  Object.assign(onStage.voice.channel!, { type: ChannelType.GuildStageVoice });
  assert.equal(await gate(onStage, context()), "stay-stage");
  staySeats.set("g", "v1");
  try {
    assert.equal(await gate(fakeMember(), context()), null, "켜져 있으면 끄기는 음성 채널 밖에서도 된다");
  } finally {
    staySeats.clear("g");
  }
});
