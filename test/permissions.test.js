"use strict";

// src/permissions.js — 권한 3계층(모더레이터/DJ/일반) 판정.
// GuildSettingsManager는 require.cache 주입으로 모킹 (실 SQLite 미접촉).

const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");

// permissions.js보다 먼저 모킹을 심어야 함
let mockDjRoles = [];
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "GuildSettingsManager.js"));
require.cache[gsmPath] = { id: gsmPath, filename: gsmPath, loaded: true, exports: { getDjRoles: async () => mockDjRoles } };

const { MOD_PERMISSIONS, isModerator, isDj, checkVoice, checkControl, checkSkip, checkRemoveTrack } = require("../src/permissions");
const S = require("../src/strings");

// perms: 보유 권한 비트 배열 / roles: 유저 보유 역할 / guildRoles: 서버에 존재하는 역할
// voice: 유저가 있는 음성 채널 id / botVoice: 봇이 있는 음성 채널 id
function fakeMember({ perms = [], roles = [], guildRoles = ["r1", "r2"], voice = null, botVoice = null } = {}) {
  return {
    permissions: { has: (p) => perms.includes(p) },
    guild: {
      id: "g",
      roles: { cache: { has: (id) => guildRoles.includes(id) } },
      members: { me: { voice: { channel: botVoice ? { id: botVoice } : null } } },
    },
    roles: { cache: { has: (id) => roles.includes(id) } },
    voice: { channel: voice ? { id: voice } : null },
  };
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
  mockDjRoles = [];
  assert.equal(await isDj(fakeMember()), true);
});

test("DJ 판정: 복수 역할 중 하나만 보유해도 DJ", async () => {
  mockDjRoles = ["r1", "r2"];
  assert.equal(await isDj(fakeMember({ roles: ["r2"] })), true);
  assert.equal(await isDj(fakeMember({ roles: ["r1", "r2"] })), true);
  assert.equal(await isDj(fakeMember({ roles: ["other"] })), false);
});

test("DJ 판정: 미보유라도 모더레이터는 항상 DJ", async () => {
  mockDjRoles = ["r1"];
  assert.equal(await isDj(fakeMember({ perms: [PermissionFlagsBits.ManageGuild] })), true);
});

test("DJ 판정: 설정 역할이 전부 삭제되면 전원 잠금 방지 위해 전원 DJ", async () => {
  mockDjRoles = ["r1", "r2"];
  assert.equal(await isDj(fakeMember({ guildRoles: [] })), true);
});

test("DJ 판정: 일부만 삭제되면 남은 역할로 판정", async () => {
  mockDjRoles = ["r1", "r2"];
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
  assert.equal(checkVoice(fakeMember({ voice: "vc2", botVoice: "vc1" })), S.ERR_SAME_CHANNEL);
});

test("재적 규칙: 음성 미참가면 거부", () => {
  assert.equal(checkVoice(fakeMember({ botVoice: "vc1" })), S.ERR_VOICE_REQUIRED);
});

test("재적 규칙: 모더레이터는 어디서든 면제", () => {
  assert.equal(checkVoice(fakeMember({ perms: [PermissionFlagsBits.BanMembers], botVoice: "vc1" })), null);
});

// ── checkControl (재생 조작 = 재적 + DJ) ─────────────────────

test("재생 조작: 같은 채널 + DJ면 허용", async () => {
  mockDjRoles = ["r1"];
  assert.equal(await checkControl(fakeMember({ roles: ["r1"], voice: "vc1", botVoice: "vc1" })), null);
});

test("재생 조작: 재적 위반이 DJ 판정보다 먼저", async () => {
  mockDjRoles = ["r1"];
  assert.equal(await checkControl(fakeMember({ roles: ["r1"], voice: "vc2", botVoice: "vc1" })), S.ERR_SAME_CHANNEL);
});

test("재생 조작: 같은 채널이어도 비-DJ는 거부", async () => {
  mockDjRoles = ["r1"];
  assert.equal(await checkControl(fakeMember({ roles: [], voice: "vc1", botVoice: "vc1" })), S.ERR_NOT_AUTHORIZED);
});

// ── checkSkip / checkRemoveTrack (요청자 본인 예외) ──────────

test("스킵: 비-DJ여도 현재 곡 요청자 본인은 가능 (재적 규칙은 적용)", async () => {
  mockDjRoles = ["r1"];
  const player = { currentTrack: { requestedBy: { id: "u1" } } };

  const requester = fakeMember({ voice: "vc1", botVoice: "vc1" });
  requester.id = "u1";
  assert.equal(await checkSkip(requester, player), null);

  const requesterWrongChannel = fakeMember({ voice: "vc2", botVoice: "vc1" });
  requesterWrongChannel.id = "u1";
  assert.notEqual(await checkSkip(requesterWrongChannel, player), null, "요청자도 재적 규칙은 적용");

  const other = fakeMember({ voice: "vc1", botVoice: "vc1" });
  other.id = "u2";
  assert.equal(await checkSkip(other, player), S.ERR_NOT_AUTHORIZED);
});

test("대기열 제거: 비-DJ여도 그 곡 요청자 본인은 가능", async () => {
  mockDjRoles = ["r1"];
  const track = { requestedBy: { id: "u1" } };

  const requester = fakeMember({ voice: "vc1", botVoice: "vc1" });
  requester.id = "u1";
  assert.equal(await checkRemoveTrack(requester, track), null);

  const other = fakeMember({ voice: "vc1", botVoice: "vc1" });
  other.id = "u2";
  assert.equal(await checkRemoveTrack(other, track), S.ERR_NOT_AUTHORIZED);
});
