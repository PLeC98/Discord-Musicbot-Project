// src/player/voice-access.ts — 봇이 그 음성 채널에 들어갈 수 있는가 · 게이트웨이로 나가기

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { leaveVoice, voiceJoinDenied } from "../../src/player/voice-access.ts";

const { ViewChannel, Connect, Speak, MoveMembers } = PermissionFlagsBits;
const channel = (perms: bigint[], extra: object = {}) => ({ type: ChannelType.GuildVoice, permissionsFor: () => ({ has: (bit: bigint) => perms.includes(bit) }), ...extra });

test("일반 음성 채널: 보기 · 연결 · 말하기, 꽉 찼으면 멤버 이동. 이미 들어가 있으면 인원은 보지 않는다", () => {
  assert.equal(voiceJoinDenied(channel([ViewChannel, Connect, Speak]), {}), null);
  assert.equal(voiceJoinDenied(channel([ViewChannel, Connect]), {}), "permission-voice");
  assert.equal(voiceJoinDenied(channel([ViewChannel, Connect, Speak], { full: true }), {}), "voice-full");
  assert.equal(voiceJoinDenied(channel([ViewChannel, Connect, Speak, MoveMembers], { full: true }), {}), null);
  assert.equal(voiceJoinDenied(channel([ViewChannel, Connect, Speak], { full: true }), {}, { inside: true }), null);
  assert.equal(voiceJoinDenied(channel([ViewChannel, Connect, Speak]), null), "permission-voice", "봇 멤버를 모른다");
});

test("스테이지: 발언자가 될 길을 본다. 이미 발언자로 들어가 있으면 보지 않는다", () => {
  const stage = channel([ViewChannel, Connect], { type: ChannelType.GuildStageVoice });
  assert.equal(voiceJoinDenied(stage, {}), "permission-stage");
  assert.equal(voiceJoinDenied(stage, { voice: { suppress: false } }, { inside: true }), null);
  assert.equal(voiceJoinDenied(stage, { voice: { suppress: true } }, { inside: true }), "permission-stage", "청중이면 발언자가 될 길이 있어야");
});

test("게이트웨이로 나간다(op 4, 채널 없음)", () => {
  const sent: unknown[] = [];
  leaveVoice({ id: "g1", shard: { send: (payload: unknown) => sent.push(payload) } } as never);
  assert.deepEqual(sent, [{ op: 4, d: { guild_id: "g1", channel_id: null, self_mute: false, self_deaf: false } }]);
});
