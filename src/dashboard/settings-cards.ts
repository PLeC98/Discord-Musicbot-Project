// 서버 설정 화면의 카드마다 누가 보고 고치는가. 화면에 보내는 것(GET), 받는 것(PUT), 카드의 경로, 서버 화면의 설정 버튼(hasSettings)이 이 표 하나를 본다.
// 보는 사람(Viewer)은 권한 수준 오버라이드를 반영한 계층(view-as 의 tierOf)과 봇을 추방할 수 있는지(오버라이드 중이면 늘 아니다)

import type { Request } from "express";
import type { GuildMember } from "discord.js";
import { TIER_RANK, type Tier } from "./contract/identity.ts";
import type { SettingsCard } from "./contract/guilds.ts";
import type { SettingsRequest } from "./request-schemas.ts";
import type { Code } from "../rules/problems.ts";
import { ageContentOn } from "../config/age-content.ts";
import { canKickBot } from "../usecases/permissions.ts";
import { getViewAs, tierOf } from "./view-as.ts";

/** 카드를 보는 조건: 이 계층 이상, 또는 디스코드에서 봇을 추방할 수 있는 사람(kick-bot) */
type Gate = Exclude<Tier, "user"> | "kick-bot";
/**
 * 카드 하나. gate: 보고 고칠 수 있는 사람, fields: 저장 본문(PUT)에서 이 카드의 필드(없으면 그 카드는 자기 경로로 고친다),
 * shown: 지금 쓰는 기능인가(아니면 화면에 없다. 고치는 것은 막지 않는다)
 */
type CardRule = { gate: Gate; fields: ReadonlyArray<keyof SettingsRequest>; shown?: () => boolean };
type CardTable = Readonly<Record<SettingsCard, CardRule>>;
/** 보는 사람 */
type Viewer = { tier: Tier; kicksBot: boolean };

const CARDS: CardTable = {
  // 상주 모드는 디스코드 /247 과 같은 DJ 조작. 켜고 끄기는 POST .../settings/stay(usecases/stay)
  stay: { gate: "dj", fields: [] },
  channel: { gate: "server-manager", fields: ["botChannelId"] },
  dj: { gate: "server-manager", fields: ["djRoleIds"] },
  sponsorblock: { gate: "server-manager", fields: ["sponsorblock"] },
  playlistAdd: { gate: "server-manager", fields: ["playlistAddMax"] },
  agePlace: { gate: "server-manager", fields: ["agePlace"], shown: ageContentOn },
  // 봇 내보내기는 디스코드에서 봇을 추방할 수 있는 사람만. POST .../settings/leave(usecases/leave-guild)
  leave: { gate: "kick-bot", fields: [] },
};

/** 카드를 볼 수 없을 때의 거절 */
const REFUSAL: Record<Gate, Code> = { "server-manager": "must-server-manager", dj: "must-dj", "kick-bot": "cannot-kick-bot" };

/** 요청의 보는 사람. 권한 수준 오버라이드 중이면 봇 추방은 늘 아니다(대역 멤버는 권한, 역할만 바꿔 소유자 판정, 역할 순서를 흉내 내지 못한다) */
async function viewerOf<P>(req: Request<P>, member: GuildMember): Promise<Viewer> {
  return { tier: await tierOf(member), kicksBot: !getViewAs(req) && canKickBot(member) };
}

const entries = (table: CardTable) => Object.entries(table) as Array<[SettingsCard, CardRule]>;
const reaches = (viewer: Viewer, rule: CardRule) => (rule.gate === "kick-bot" ? viewer.kicksBot : TIER_RANK[viewer.tier] >= TIER_RANK[rule.gate]);

/** 그 사람에게 보이는 카드(고칠 수 있고 지금 쓰는 기능) */
function shownCards(viewer: Viewer, table: CardTable = CARDS): SettingsCard[] {
  return entries(table)
    .filter(([, rule]) => reaches(viewer, rule) && (rule.shown?.() ?? true))
    .map(([card]) => card);
}

/** 그 사람이 저장 본문(PUT)으로 고칠 수 있는 카드가 하나라도 있나(지금 쓰지 않는 기능의 카드 포함) */
const editsAny = (viewer: Viewer, table: CardTable = CARDS) => entries(table).some(([, rule]) => rule.fields.length > 0 && reaches(viewer, rule));

// 계층 카드들 가운데 가장 낮은 계층의 거절(봇 추방 카드는 계층이 아니라 세지 않는다)
function lowestRefusal(rules: CardRule[]): Code {
  const lowest = rules.reduce<Exclude<Tier, "user">>((low, { gate }) => (gate !== "kick-bot" && TIER_RANK[gate] < TIER_RANK[low] ? gate : low), "server-manager");
  return REFUSAL[lowest];
}

/** 보이는 카드가 하나도 없을 때의 거절: 가장 낮은 카드 계층의 거절 */
const noCardRefusal = (table: CardTable = CARDS) => lowestRefusal(entries(table).map(([, rule]) => rule));

/** 저장 본문으로 고칠 카드가 없을 때의 거절: 본문 필드가 있는 카드 가운데 가장 낮은 계층의 거절 */
const noBodyCardRefusal = (table: CardTable = CARDS) => lowestRefusal(entries(table).flatMap(([, rule]) => (rule.fields.length ? [rule] : [])));

/** 저장 본문에 그 사람이 고칠 수 없는 카드의 필드가 있으면 그 카드의 거절. 하나라도 있으면 본문 전체를 거절한다(부분 저장 없음) */
function fieldRefusal(viewer: Viewer, body: Partial<Record<keyof SettingsRequest, unknown>>, table: CardTable = CARDS): Code | null {
  for (const [, rule] of entries(table)) {
    if (!reaches(viewer, rule) && rule.fields.some((field) => body[field] !== undefined)) return REFUSAL[rule.gate];
  }
  return null;
}

/** 그 카드를 볼 수 없을 때의 거절 */
const cardRefusal = (card: SettingsCard, table: CardTable = CARDS) => REFUSAL[table[card].gate];

export { CARDS, viewerOf, shownCards, editsAny, noCardRefusal, noBodyCardRefusal, cardRefusal, fieldRefusal };
export type { CardRule, CardTable, Viewer };
