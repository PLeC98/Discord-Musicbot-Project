"use strict";

const { PermissionsBitField, PermissionFlagsBits } = require("discord.js");

/**
 * 권한 수준 오버라이드 — 봇 운영자가 낮은 계층의 화면과 동작을 그대로 재현해 보기 위한 점검용.
 * 디스코드의 "역할 적용해서 서버 보기"와 같은 발상으로, 판정 로직(src/permissions.js)은 건드리지 않고
 * 입력(권한 비트·보유 역할)만 갈아끼운다. 그래야 UI 표시와 서버 강제가 같이 따라온다.
 *
 * 상향은 구조적으로 불가능하다 — 설정은 진짜 운영자만 할 수 있고(requireOwner) 모든 계층이 운영자 이하다.
 */

const TIERS = ["owner", "moderator", "dj", "user"];

/** 세션에 걸린 오버라이드 계층. 없거나 알 수 없는 값이면 null(=오버라이드 없음). */
function getViewAs(req) {
  const tier = req?.session?.viewAs;
  return TIERS.includes(tier) ? tier : null;
}

// isModerator는 MOD_PERMISSIONS 중 하나만 있으면 통과하므로 대표값 하나면 충분하다.
const MOD_BITS = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
const NO_BITS = new PermissionsBitField(0n);

// isDj는 member.roles.cache.has(역할ID)만 본다. 서버마다 다른 DJ 역할 ID를 미리 알 필요 없이
// "무슨 역할이든 갖고 있다"로 흉내낸다. 모더레이터 여부는 permissions가 따로 결정한다.
const ANY_ROLE = { cache: { has: () => true } };
const NO_ROLE = { cache: { has: () => false } };

const SPEC = {
  moderator: { permissions: MOD_BITS, roles: NO_ROLE }, // isDj가 모더레이터에서 단락되므로 역할은 불필요
  dj: { permissions: NO_BITS, roles: ANY_ROLE },
  user: { permissions: NO_BITS, roles: NO_ROLE },
};

/**
 * 오버라이드가 걸려 있으면 권한·역할만 바꿔 끼운 대역 멤버를 돌려준다 (아니면 원본 그대로).
 *
 * Object.create로 원본을 프로토타입에 두므로 id·guild·voice 등 나머지는 그대로 동작한다.
 * voice는 guild.voiceStates.cache를 읽는 getter라 프로토타입 체인으로 이어지고, 음성 재적은
 * 권한이 아니라 사실이므로 오버라이드 대상이 아니다.
 */
function shadowMember(req, member) {
  const tier = getViewAs(req);
  const spec = tier && SPEC[tier];
  if (!spec || !member) return member;

  return Object.create(member, {
    permissions: { value: spec.permissions, enumerable: true },
    roles: { value: spec.roles, enumerable: true },
  });
}

module.exports = { TIERS, getViewAs, shadowMember };
