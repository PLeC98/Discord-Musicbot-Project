import { PermissionsBitField, PermissionFlagsBits, type GuildMember } from "discord.js";
import type { Request } from "express";
import { isDj, isServerManager } from "../usecases/permissions.ts";
import { isTier, type Tier } from "./contract/identity.ts";
import { isRealOwner } from "./owner.ts";

/**
 * 권한 수준 오버라이드. 봇 운영자가 낮은 계층의 화면과 동작을 그대로 재현해 보기 위한 점검용.
 * 디스코드의 "역할 적용해서 서버 보기"와 같은 발상으로, 판정 로직(src/usecases/permissions.ts)은 건드리지 않고
 * 입력(권한 비트, 보유 역할)만 교체한다. 그래야 UI 표시와 서버 강제가 같이 따라온다.
 *
 * 낮추기만 한다: 진짜 운영자의 세션에서만 쓰고(OWNER_ID가 바뀐 옛 운영자의 세션에 남은 값은 쓰지 않는다),
 * 서버마다 그 서버에서의 실제 계층보다 낮을 때만 바꾼다(참가한 서버 안에서도 운영자 우대는 없다).
 */

/** 세션에 걸린 오버라이드 계층을 돌려준다. 진짜 운영자가 아니거나 값이 없거나 알 수 없는 값이면 null(=오버라이드 없음)이다 */
function getViewAs<P>(req: Request<P>): Tier | null {
  const tier = req.session?.viewAs;
  return isTier(tier) && isRealOwner(req) ? tier : null;
}

/**
 * 권한 판정용 운영자 여부. 권한 수준 오버라이드(viewAs)가 걸려 있으면 운영자가 아니다(그 계층으로 낮춰 본다).
 * 오버라이드를 켜고 끄는 경로 자체는 isRealOwner를 써야 한다. 아니면 스스로를 잠근다.
 */
function isOwner<P>(req: Request<P>) {
  return isRealOwner(req) && !getViewAs(req);
}

/** 계층의 높이다(높을수록 큰 수) */
const RANK: Record<Tier, number> = { "server-manager": 2, dj: 1, user: 0 };

/** 그 서버에서의 실제 계층을 구한다 */
async function tierOf(member: GuildMember): Promise<Tier> {
  if (isServerManager(member)) return "server-manager";
  return (await isDj(member)) ? "dj" : "user";
}

// 서버 관리자 판정(isServerManager)은 서버 관리 권한 하나를 본다.
const MANAGER_BITS = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
const NO_BITS = new PermissionsBitField(0n);

// isDj는 member.roles.cache.has(역할ID)만 본다. 서버마다 다른 DJ 역할 ID를 미리 알 필요 없이
// "무슨 역할이든 갖고 있다"로 흉내 낸다. 서버 관리자 여부는 permissions가 따로 결정한다.
const ANY_ROLE = { cache: { has: () => true } };
const NO_ROLE = { cache: { has: () => false } };

const SPEC: Partial<Record<Tier, { permissions: PermissionsBitField; roles: { cache: { has(id: string): boolean } } }>> = {
  "server-manager": { permissions: MANAGER_BITS, roles: NO_ROLE }, // 서버 관리자는 역할과 관계없이 isDj를 통과하므로 역할은 필요 없다
  dj: { permissions: NO_BITS, roles: ANY_ROLE },
  user: { permissions: NO_BITS, roles: NO_ROLE },
};

/**
 * 오버라이드가 걸려 있고 그 서버에서의 실제 계층보다 낮으면 권한, 역할만 교체한 대역 멤버를 돌려준다(아니면 원본 그대로).
 *
 * Object.create로 원본을 프로토타입에 두므로 id, guild, voice 등 나머지는 그대로 동작한다.
 * voice는 guild.voiceStates.cache를 읽는 getter라 프로토타입 체인으로 이어지고, 음성 채널 접속은
 * 권한이 아니라 사실이므로 오버라이드 대상이 아니다.
 */
async function shadowMember<M extends GuildMember | null, P>(req: Request<P>, member: M): Promise<M> {
  const tier = getViewAs(req);
  const spec = tier && SPEC[tier];
  if (!spec || !member) return member;
  if (RANK[tier] >= RANK[await tierOf(member)]) return member;

  return Object.create(member, {
    permissions: { value: spec.permissions, enumerable: true },
    roles: { value: spec.roles, enumerable: true },
  });
}

export { getViewAs, isOwner, shadowMember };
