// src/usecases/permissions.ts — 권한 3계층(모더레이터/DJ/일반) 판정.
// 서버 설정은 진짜를 임시 DB 로 쓴다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember, type TextBasedChannel } from "discord.js";
import { fake } from "../helpers/fake.ts";

import { openTempStore, setGuild } from "../helpers/temp-store.ts";
const store = openTempStore("perm-");
after(() => store.close());

const { MOD_PERMISSIONS, isModerator, isDj, checkVoice, checkControl, checkAdd, checkSummon, checkPanelChannel, checkSkip, checkRemoveTrack } = await import("../../src/usecases/permissions.ts");

// perms: 보유 권한 비트 배열 / roles: 유저 보유 역할 / guildRoles: 서버에 존재하는 역할
// voice: 유저가 있는 음성 채널 id / botVoice: 봇이 있는 음성 채널 id
// botChannelPerms: 유저의 음성 채널에서 봇이 가지는 권한 (checkSummon 검사 대상) / full: 그 채널이 꽉 찼다
// hiddenVoice: 유저가 음성 채널에 있지만 봇이 그 채널을 모른다 / botTimedOutUntil: 봇의 타임아웃이 끝나는 때
type MemberOptions = { id?: string; perms?: bigint[]; roles?: string[]; guildRoles?: string[]; voice?: string | null; botVoice?: string | null; botChannelPerms?: bigint[] | null; full?: boolean; hiddenVoice?: boolean; botTimedOutUntil?: number | null; stage?: boolean };
const CAN_JOIN = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];

function fakeMember({ id = "u0", perms = [], roles = [], guildRoles = ["r1", "r2"], voice = null, botVoice = null, botChannelPerms = CAN_JOIN, full = false, hiddenVoice = false, botTimedOutUntil = null, stage = false }: MemberOptions = {}) {
  return fake<GuildMember>({
    id,
    permissions: { has: (p: bigint) => perms.includes(p) },
    guild: {
      id: "g",
      roles: { cache: { has: (id: string) => guildRoles.includes(id) } },
      members: { me: { voice: { channel: botVoice ? { id: botVoice } : null }, communicationDisabledUntilTimestamp: botTimedOutUntil } },
    },
    roles: { cache: { has: (id: string) => roles.includes(id) } },
    voice: {
      channelId: voice,
      channel: voice && !hiddenVoice ? { id: voice, full, type: stage ? ChannelType.GuildStageVoice : ChannelType.GuildVoice, permissionsFor: () => (botChannelPerms === null ? null : { has: (p: bigint) => botChannelPerms.includes(p) }) } : null,
    },
  });
}

// ── isModerator ──────────────────────────────────────────────

test("모더레이터: MOD_PERMISSIONS 중 하나라도 있으면 통과", () => {
  for (const perm of MOD_PERMISSIONS) {
    assert.equal(isModerator(fakeMember({ perms: [perm] })), true);
  }
  assert.equal(isModerator(fakeMember()), false);
  assert.equal(isModerator(fakeMember({ perms: [PermissionFlagsBits.SendMessages] })), false, "일반 권한은 모더레이터 아님");
});

// ── isDj (복수 역할) ─────────────────────────────────────────

test("DJ 판정: 미설정 서버는 전원 DJ", async () => {
  setGuild("g", { djRoles: [] });
  assert.equal(await isDj(fakeMember()), true);
});

test("DJ 판정: 복수 역할 중 하나만 보유해도 DJ", async () => {
  setGuild("g", { djRoles: ["r1", "r2"] });
  assert.equal(await isDj(fakeMember({ roles: ["r2"] })), true);
  assert.equal(await isDj(fakeMember({ roles: ["r1", "r2"] })), true);
  assert.equal(await isDj(fakeMember({ roles: ["other"] })), false);
});

test("DJ 판정: 미보유라도 모더레이터는 항상 DJ", async () => {
  setGuild("g", { djRoles: ["r1"] });
  assert.equal(await isDj(fakeMember({ perms: [PermissionFlagsBits.ManageGuild] })), true);
});

test("DJ 판정: 설정 역할이 전부 삭제되면 전원 잠금 방지 위해 전원 DJ", async () => {
  setGuild("g", { djRoles: ["r1", "r2"] });
  assert.equal(await isDj(fakeMember({ guildRoles: [] })), true);
});

test("DJ 판정: 일부만 삭제되면 남은 역할로 판정", async () => {
  setGuild("g", { djRoles: ["r1", "r2"] });
  assert.equal(await isDj(fakeMember({ roles: ["r2"], guildRoles: ["r2"] })), true);
  assert.equal(await isDj(fakeMember({ roles: ["r1"], guildRoles: ["r2"] })), false);
});

// ── checkVoice (재적 규칙) ───────────────────────────────────

test("재적 규칙: 봇 유휴(음성 미접속)면 제약 없음", () => {
  assert.equal(checkVoice(fakeMember()), null);
});

test("재적 규칙: 봇과 같은 채널이면 통과", () => {
  assert.equal(checkVoice(fakeMember({ voice: "vc1", botVoice: "vc1" })), null);
});

test("재적 규칙: 다른 채널이면 거부", () => {
  assert.equal(checkVoice(fakeMember({ voice: "vc2", botVoice: "vc1" })), "must-be-in-same-voice");
});

test("재적 규칙: 봇이 음성 채널에 있으면 음성 미참가도 같은 채널에 오라고 거부", () => {
  assert.equal(checkVoice(fakeMember({ botVoice: "vc1" })), "must-be-in-same-voice");
});

test("재적 규칙: 모더레이터는 어디서든 면제", () => {
  assert.equal(checkVoice(fakeMember({ perms: [PermissionFlagsBits.BanMembers], botVoice: "vc1" })), null);
});

// ── checkControl (재생 조작 = 재적 + DJ) ─────────────────────

test("재생 조작: 같은 채널 + DJ면 허용", async () => {
  setGuild("g", { djRoles: ["r1"] });
  assert.equal(await checkControl(fakeMember({ roles: ["r1"], voice: "vc1", botVoice: "vc1" })), null);
});

test("재생 조작: 재적 위반이 DJ 판정보다 먼저", async () => {
  setGuild("g", { djRoles: ["r1"] });
  assert.equal(await checkControl(fakeMember({ roles: ["r1"], voice: "vc2", botVoice: "vc1" })), "must-be-in-same-voice");
});

test("재생 조작: 같은 채널이어도 비-DJ는 거부", async () => {
  setGuild("g", { djRoles: ["r1"] });
  assert.equal(await checkControl(fakeMember({ roles: [], voice: "vc1", botVoice: "vc1" })), "must-dj");
});

// ── checkSkip / checkRemoveTrack (요청자 본인 예외) ──────────

test("스킵: 비-DJ여도 현재 곡 요청자 본인은 가능 (재적 규칙은 적용)", async () => {
  setGuild("g", { djRoles: ["r1"] });
  const player = { currentTrack: { requestedBy: { id: "u1" } } };

  const requester = fakeMember({ id: "u1", voice: "vc1", botVoice: "vc1" });
  assert.equal(await checkSkip(requester, player), null);

  const requesterWrongChannel = fakeMember({ id: "u1", voice: "vc2", botVoice: "vc1" });
  assert.notEqual(await checkSkip(requesterWrongChannel, player), null, "요청자도 재적 규칙은 적용");

  const other = fakeMember({ id: "u2", voice: "vc1", botVoice: "vc1" });
  assert.equal(await checkSkip(other, player), "must-dj");
});

test("대기열 제거: 비-DJ여도 그 곡 요청자 본인은 가능", async () => {
  setGuild("g", { djRoles: ["r1"] });
  const track = { requestedBy: { id: "u1" } };

  const requester = fakeMember({ id: "u1", voice: "vc1", botVoice: "vc1" });
  assert.equal(await checkRemoveTrack(requester, track), null);

  const other = fakeMember({ id: "u2", voice: "vc1", botVoice: "vc1" });
  assert.equal(await checkRemoveTrack(other, track), "must-dj");
});

// ── checkSummon (봇 유휴 시 소환 가능 여부) ─────────────────

test("소환: 봇이 이미 음성 채널에 있으면 검사하지 않는다", () => {
  assert.equal(checkSummon(fakeMember({ botVoice: "vc1" })), null);
  assert.equal(checkSummon(fakeMember({ botVoice: "vc1", botChannelPerms: [] })), null, "봇이 접속 중이면 채널 권한을 보지 않음");
});

test("소환: 봇 유휴 + 요청자 음성 미참가는 거부", () => {
  assert.equal(checkSummon(fakeMember()), "must-be-in-voice");
});

test("소환: 모더레이터여도 본인이 음성 채널에 있어야 한다 (재적 규칙과 달리 면제 없음)", () => {
  assert.equal(checkSummon(fakeMember({ perms: [PermissionFlagsBits.ManageGuild] })), "must-be-in-voice");
});

test("소환: 봇에게 채널 보기 · 연결 · 말하기 가운데 하나라도 없으면 거부", () => {
  for (const missing of CAN_JOIN) assert.equal(checkSummon(fakeMember({ voice: "vc1", botChannelPerms: CAN_JOIN.filter((p) => p !== missing) })), "permission-voice", String(missing));
  assert.equal(checkSummon(fakeMember({ voice: "vc1", botChannelPerms: null })), "permission-voice", "권한 조회 실패");
  assert.equal(checkSummon(fakeMember({ voice: "vc1", hiddenVoice: true })), "permission-voice", "봇이 볼 수 없는 채널은 음성 채널에 없다고 하지 않는다");
});

test("소환: 꽉 찬 채널은 멤버 이동 권한이 있어야, 봇이 타임아웃이면 거부", () => {
  assert.equal(checkSummon(fakeMember({ voice: "vc1", full: true })), "voice-full");
  assert.equal(checkSummon(fakeMember({ voice: "vc1", full: true, botChannelPerms: [...CAN_JOIN, PermissionFlagsBits.MoveMembers] })), null);
  assert.equal(checkSummon(fakeMember({ voice: "vc1", botTimedOutUntil: Date.now() + 60_000 })), "bot-timed-out");
  assert.equal(checkSummon(fakeMember({ voice: "vc1", botTimedOutUntil: Date.now() - 60_000 })), null, "끝난 타임아웃");
});

test("소환: 요청자가 음성에 있고 봇 권한이 갖춰지면 통과", () => {
  assert.equal(checkSummon(fakeMember({ voice: "vc1" })), null);
});

test("소환: 스테이지는 말하기 권한 대신 스스로 발언자가 되거나(멤버 음소거) 발언을 요청할 수 있어야(발언권 요청)", () => {
  const { ViewChannel, Connect, MuteMembers, RequestToSpeak } = PermissionFlagsBits;
  assert.equal(checkSummon(fakeMember({ voice: "st1", stage: true, botChannelPerms: [ViewChannel, Connect] })), "permission-stage");
  assert.equal(checkSummon(fakeMember({ voice: "st1", stage: true, botChannelPerms: [ViewChannel, Connect, RequestToSpeak] })), null);
  assert.equal(checkSummon(fakeMember({ voice: "st1", stage: true, botChannelPerms: [ViewChannel, Connect, MuteMembers] })), null);
  assert.equal(checkSummon(fakeMember({ voice: "st1", stage: true, botChannelPerms: [ViewChannel, RequestToSpeak] })), "permission-voice", "연결은 스테이지도 든다");
});

// ── checkPanelChannel (패널을 올릴 채널) ─────────────────────

test("패널 채널: 전용 채널에 올릴 수 있으면 어디서 쳐도 통과, 아니면 친 채널. 둘 다 안 되면 까닭(들어가지 않은 비공개 스레드는 따로)", async () => {
  const me = {};
  const postable = { send: async () => ({}), isThread: () => false };
  const locked = { ...postable, guild: { members: { me } }, permissionsFor: () => ({ has: () => false }) };
  const privateThread = { send: async () => ({}), type: ChannelType.PrivateThread, joined: false, isThread: () => true, sendable: false };
  const guild = (dedicated: object | null) => fake<Guild>({ id: "pg", channels: { cache: new Map(dedicated ? [["dc", dedicated]] : []) } });

  setGuild("pg", { botChannel: "dc" });
  assert.equal(await checkPanelChannel(guild(postable), fake<TextBasedChannel>(locked)), null, "전용 채널로 간다");
  assert.equal(await checkPanelChannel(guild(locked), fake<TextBasedChannel>(postable)), null, "전용 채널에 못 올리면 친 채널");
  assert.equal(await checkPanelChannel(guild(locked), fake<TextBasedChannel>(locked)), "permission-text");
  setGuild("pg", { botChannel: null });
  assert.equal(await checkPanelChannel(guild(null), fake<TextBasedChannel>(privateThread)), "thread-not-joined");
  assert.equal(await checkPanelChannel(guild(null), fake<TextBasedChannel>({ ...privateThread, joined: true, sendable: true })), null);
});

// 곡 추가 진입점(/play·/playfirst·전용 채널)은 재적 규칙과 소환 검사를 이어 붙인다.
// 둘 중 하나만 쓰면 한쪽 상태가 빈다 — checkAdd는 봇 유휴 시 항상 통과, checkSummon은 봇 접속 시 항상 통과.
test("진입점 조합: checkAdd + checkSummon이 봇의 두 상태를 모두 덮는다", () => {
  // 봇 유휴 → 소환 검사가 담당
  assert.equal(checkAdd(fakeMember()), null, "checkAdd 단독은 봇 유휴 시 통과시킨다");
  assert.equal(checkAdd(fakeMember()) || checkSummon(fakeMember()), "must-be-in-voice");

  // 봇 접속 중 → 재적 규칙이 담당
  const other = { voice: "vc2", botVoice: "vc1" };
  assert.equal(checkSummon(fakeMember(other)), null, "checkSummon 단독은 봇 접속 시 통과시킨다");
  assert.equal(checkAdd(fakeMember(other)) || checkSummon(fakeMember(other)), "must-be-in-same-voice");

  // 정상 경로
  const ok = { voice: "vc1", botVoice: "vc1" };
  assert.equal(checkAdd(fakeMember(ok)) || checkSummon(fakeMember(ok)), null);
});
