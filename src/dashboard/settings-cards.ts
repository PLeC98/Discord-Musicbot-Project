// 서버 설정 화면의 카드마다 누가 보고 고치는가. 화면에 보내는 것(GET), 받는 것(PUT), 서버 화면의 설정 버튼(hasSettings)이 이 표 하나를 본다.
// 계층은 권한 수준 오버라이드를 반영한 멤버의 계층(view-as 의 tierOf)이다

import { TIER_RANK, type Tier } from "./contract/identity.ts";
import type { SettingsCard } from "./contract/guilds.ts";
import type { SettingsRequest } from "./request-schemas.ts";
import type { Code } from "../rules/problems.ts";
import { ageContentOn } from "../config/age-content.ts";

/**
 * 카드 하나. tier: 보고 고칠 수 있는 가장 낮은 계층, fields: 저장 본문(PUT)에서 이 카드의 필드(없으면 그 카드는 자기 경로로 고친다),
 * shown: 지금 쓰는 기능인가(아니면 화면에 없다. 고치는 것은 막지 않는다)
 */
type CardRule = { tier: Exclude<Tier, "user">; fields: ReadonlyArray<keyof SettingsRequest>; shown?: () => boolean };
type CardTable = Readonly<Record<SettingsCard, CardRule>>;

const CARDS: CardTable = {
  // 상주 모드는 디스코드 /247 과 같은 DJ 조작. 켜고 끄기는 POST .../settings/stay(usecases/stay)
  stay: { tier: "dj", fields: [] },
  channel: { tier: "server-manager", fields: ["botChannelId"] },
  dj: { tier: "server-manager", fields: ["djRoleIds"] },
  sponsorblock: { tier: "server-manager", fields: ["sponsorblock"] },
  playlistAdd: { tier: "server-manager", fields: ["playlistAddMax"] },
  agePlace: { tier: "server-manager", fields: ["agePlace"], shown: ageContentOn },
};

/** 카드 계층이 막을 때의 거절 */
const REFUSAL: Record<CardRule["tier"], Code> = { "server-manager": "must-server-manager", dj: "must-dj" };

const entries = (table: CardTable) => Object.entries(table) as Array<[SettingsCard, CardRule]>;
const reaches = (tier: Tier, rule: CardRule) => TIER_RANK[tier] >= TIER_RANK[rule.tier];

/** 그 계층에게 보이는 카드(고칠 수 있고 지금 쓰는 기능) */
function shownCards(tier: Tier, table: CardTable = CARDS): SettingsCard[] {
  return entries(table)
    .filter(([, rule]) => reaches(tier, rule) && (rule.shown?.() ?? true))
    .map(([card]) => card);
}

/** 그 계층이 저장 본문(PUT)으로 고칠 수 있는 카드가 하나라도 있나(지금 쓰지 않는 기능의 카드 포함) */
const editsAny = (tier: Tier, table: CardTable = CARDS) => entries(table).some(([, rule]) => rule.fields.length > 0 && reaches(tier, rule));

// 카드들 가운데 가장 낮은 계층의 거절
function lowestRefusal(rules: CardRule[]): Code {
  const lowest = rules.reduce((low, rule) => (TIER_RANK[rule.tier] < TIER_RANK[low] ? rule.tier : low), "server-manager" as CardRule["tier"]);
  return REFUSAL[lowest];
}

/** 보이는 카드가 하나도 없을 때의 거절: 가장 낮은 카드 계층의 거절 */
const noCardRefusal = (table: CardTable = CARDS) => lowestRefusal(entries(table).map(([, rule]) => rule));

/** 저장 본문으로 고칠 카드가 없을 때의 거절: 본문 필드가 있는 카드 가운데 가장 낮은 계층의 거절 */
const noBodyCardRefusal = (table: CardTable = CARDS) => lowestRefusal(entries(table).flatMap(([, rule]) => (rule.fields.length ? [rule] : [])));

/** 저장 본문에 그 계층이 고칠 수 없는 카드의 필드가 있으면 그 카드 계층의 거절. 하나라도 있으면 본문 전체를 거절한다(부분 저장 없음) */
function fieldRefusal(tier: Tier, body: Partial<Record<keyof SettingsRequest, unknown>>, table: CardTable = CARDS): Code | null {
  for (const [, rule] of entries(table)) {
    if (!reaches(tier, rule) && rule.fields.some((field) => body[field] !== undefined)) return REFUSAL[rule.tier];
  }
  return null;
}

/** 그 카드를 볼 수 없을 때의 거절 */
const cardRefusal = (card: SettingsCard, table: CardTable = CARDS) => REFUSAL[table[card].tier];

export { CARDS, shownCards, editsAny, noCardRefusal, noBodyCardRefusal, cardRefusal, fieldRefusal };
export type { CardRule, CardTable };
