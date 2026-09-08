"use strict";

// dashboard/server/viewAs.js — 권한 수준 오버라이드.
//
// 핵심 계약 두 가지:
//  1) 판정 로직(src/permissions.js)은 그대로 두고 입력(권한·역할)만 갈아끼운다 → UI와 서버 강제가 함께 따라온다.
//  2) 낮춰도 스스로를 잠그지 않는다 — requireOwner는 실 운영자 기준(isRealOwner)이라 해제 경로가 남는다.

// 봇 운영자 판정은 요청마다 config.dashboard.ownerId와 대조한다.
// dotenv는 이미 설정된 process.env를 덮지 않으므로 .env가 있어도 이 값이 이긴다.
process.env.OWNER_ID = "owner";

const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");

// permissions.js보다 먼저 모킹을 심어야 함 (실 SQLite 미접촉)
let mockDjRoles = [];
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "GuildSettingsManager.js"));
require.cache[gsmPath] = { id: gsmPath, filename: gsmPath, loaded: true, exports: { getDjRoles: async () => mockDjRoles } };

const { TIERS, getViewAs, shadowMember } = require("../dashboard/server/viewAs");
const { isOwner, isRealOwner } = require("../dashboard/server/owner");
const { isModerator, isDj, checkVoice, checkControl, checkAdd } = require("../src/permissions");
const S = require("../src/strings");

const req = (tier, userId = "owner") => ({ session: { user: { id: userId }, ...(tier === undefined ? {} : { viewAs: tier }) } });

// 실 GuildMember를 흉내내되 permissions/roles를 프로토타입 쪽 getter가 아닌 own 프로퍼티로 둔다.
// shadowMember는 Object.create로 이걸 프로토타입에 놓으므로 어느 쪽이든 가려진다.
function member({ perms = [], roles = [], voice = null, botVoice = null } = {}) {
  return {
    id: "u1",
    permissions: { has: (p) => perms.includes(p) },
    roles: { cache: { has: (id) => roles.includes(id) } },
    guild: { id: "g", roles: { cache: { has: () => true } }, members: { me: { voice: { channel: botVoice ? { id: botVoice } : null } } } },
    voice: { channel: voice ? { id: voice } : null },
  };
}

// ── 대역 멤버 ────────────────────────────────────────────────────────────────

test("오버라이드가 없으면 원본을 그대로 돌려준다", () => {
  const m = member({ perms: [PermissionFlagsBits.ManageGuild] });
  assert.equal(shadowMember(req(undefined), m), m);
  assert.equal(shadowMember(req(null), m), m);
  assert.equal(shadowMember(req("nonsense"), m), m, "모르는 값은 오버라이드 없음으로 취급");
  assert.equal(shadowMember(req("owner"), m), m, "운영자 계층은 바꿀 것이 없다");
});

test("moderator: 모더레이터로 승격돼 재적 규칙까지 면제된다", async () => {
  const m = shadowMember(req("moderator"), member({ voice: null, botVoice: "vc-A" }));
  assert.equal(isModerator(m), true);
  assert.equal(checkVoice(m), null, "모더레이터는 음성에 없어도 통과");
  assert.equal(await checkControl(m), null);
});

test("dj: 모더레이터는 아니지만 DJ 역할 보유로 취급된다", async () => {
  mockDjRoles = ["dj-role"];
  const m = shadowMember(req("dj"), member({ perms: [PermissionFlagsBits.ManageGuild], voice: "vc-A", botVoice: "vc-A" }));

  assert.equal(isModerator(m), false, "원본이 모더레이터여도 계층이 내려간다");
  assert.equal(await isDj(m), true);
  assert.equal(await checkControl(m), null);
});

test("dj: 모더레이터 면제가 사라지므로 재적 규칙을 받는다", async () => {
  mockDjRoles = ["dj-role"];
  const other = shadowMember(req("dj"), member({ perms: [PermissionFlagsBits.ManageGuild], voice: "vc-B", botVoice: "vc-A" }));
  assert.equal(await checkControl(other), S.ERR_SAME_CHANNEL);

  const nowhere = shadowMember(req("dj"), member({ perms: [PermissionFlagsBits.ManageGuild], voice: null, botVoice: "vc-A" }));
  assert.equal(checkAdd(nowhere), S.ERR_VOICE_REQUIRED);
});

test("user: DJ 역할이 설정된 서버에서는 조작이 막힌다", async () => {
  mockDjRoles = ["dj-role"];
  const m = shadowMember(req("user"), member({ perms: [PermissionFlagsBits.ManageGuild], roles: ["dj-role"], voice: "vc-A", botVoice: "vc-A" }));

  assert.equal(isModerator(m), false);
  assert.equal(await isDj(m), false, "원본이 DJ 역할을 갖고 있어도 계층이 내려간다");
  assert.equal(await checkControl(m), S.ERR_NOT_AUTHORIZED);
  assert.equal(checkAdd(m), null, "곡 추가는 계층 무관 — 재적만 맞으면 통과");
});

test("user: DJ 역할 미설정 서버에서는 전원 DJ라 그대로 통과한다 (그 서버의 진짜 동작)", async () => {
  mockDjRoles = [];
  const m = shadowMember(req("user"), member({ voice: "vc-A", botVoice: "vc-A" }));
  assert.equal(await isDj(m), true);
  assert.equal(await checkControl(m), null);
});

test("대역 멤버도 id·guild·voice는 원본 그대로다 (음성 재적은 권한이 아니라 사실)", () => {
  const orig = member({ voice: "vc-A", botVoice: "vc-A" });
  const m = shadowMember(req("user"), orig);

  assert.equal(m.id, "u1");
  assert.equal(m.guild.id, "g");
  assert.equal(m.voice.channel.id, "vc-A");
  assert.equal(checkVoice(m), null, "같은 채널이면 계층과 무관하게 통과");
  assert.equal(orig.permissions.has(PermissionFlagsBits.ManageGuild), false, "원본은 변형되지 않는다");
});

// ── 운영자 판정 ──────────────────────────────────────────────────────────────

test("isOwner는 오버라이드를 따르고, isRealOwner는 따르지 않는다", () => {
  for (const tier of ["moderator", "dj", "user"]) {
    assert.equal(isOwner(req(tier)), false, `${tier}로 낮추면 운영자 권한이 빠진다`);
    assert.equal(isRealOwner(req(tier)), true, `${tier}로 낮춰도 해제 경로(requireOwner)는 남는다`);
  }

  assert.equal(isOwner(req(undefined)), true);
  assert.equal(isOwner(req("owner")), true);
});

test("운영자가 아니면 오버라이드로 권한을 얻을 수 없다", () => {
  for (const tier of [undefined, "owner", "moderator"]) {
    assert.equal(isOwner(req(tier, "someone-else")), false);
    assert.equal(isRealOwner(req(tier, "someone-else")), false);
  }
});

test("getViewAs는 알려진 계층만 통과시킨다", () => {
  for (const tier of TIERS) assert.equal(getViewAs(req(tier)), tier);
  for (const bad of [undefined, null, "", "admin", "OWNER", 1, {}]) assert.equal(getViewAs(req(bad)), null);
  assert.equal(getViewAs(undefined), null, "세션이 없어도 던지지 않는다");
});
