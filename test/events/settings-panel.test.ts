// src/discord/interactions/settings-panel-handler.ts · commands/setting — /setting 한 화면(DJ 역할 · SponsorBlock · 연령 제한 콘텐츠).
// 고르거나 누르면 바로 저장하고 화면을 지금 값으로 다시 그린다. 봇 전체에서 끈 기능의 부분은 없다. 서버 설정은 진짜를 임시 DB 로 쓴다.

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type ButtonInteraction, type RoleSelectMenuInteraction, type StringSelectMenuInteraction } from "discord.js";

import { openTempStore } from "../helpers/temp-store.ts";
import { interactionKind, type InteractionKind } from "../helpers/interaction-kind.ts";
import { screenOf, textOf, selectOf } from "../helpers/cv2.ts";
const temp = openTempStore("settings-panel-");
const settings = await import("../../src/store/guild-settings.ts");
const documents = await import("../../src/config/documents.ts");
const config = (await import("../../src/config/index.ts")).default;
const { fakeWith, fakeBot } = await import("../helpers/fake.ts");
const interactionCreate = (await import("../../src/discord/events/interaction-create.ts")).default;
const { panel } = await import("../../src/discord/interactions/settings-panel-handler.ts");
const sponsorOn = config.sponsorblock.enabled;
after(() => {
  config.sponsorblock.enabled = sponsorOn;
  documents._use("age-content");
  temp.close();
});
beforeEach(() => {
  temp.settings().exec("DELETE FROM guild_settings");
  settings.forgetCache();
  config.sponsorblock.enabled = true;
  documents._use("age-content", { enabled: true, changedAt: 1 });
});

const guild = { id: "g1", roles: { cache: { has: (id: string) => ["r1", "r2"].includes(id) } } } as unknown as Parameters<typeof panel>[0];

type Payload = { components: Array<{ toJSON(): unknown }> };
type Node = { type: number; custom_id?: string; label?: string; style?: number; disabled?: boolean; components?: Node[]; accessory?: Node };

// 버튼 전부(섹션 옆 버튼 포함)
function buttonsOf(payload: Payload) {
  const out: Node[] = [];
  const walk = (n: Node) => {
    if (n.type === 2) out.push(n);
    for (const c of n.components ?? []) walk(c);
    if (n.accessory) walk(n.accessory);
  };
  for (const c of payload.components) walk(c.toJSON() as Node);
  return out;
}
// 컴포넌트 수(디스코드가 세는 대로: 안에 든 것 · 섹션 옆 것까지)
function countOf(payload: Payload) {
  let count = 0;
  const walk = (n: Node) => {
    count++;
    for (const c of n.components ?? []) walk(c);
    if (n.accessory) walk(n.accessory);
  };
  for (const c of payload.components) walk(c.toJSON() as Node);
  return count;
}

function fakeInteraction(kind: InteractionKind, customId: string, { values = [] as string[], canManage = true } = {}) {
  const ix = fakeWith<ButtonInteraction | RoleSelectMenuInteraction | StringSelectMenuInteraction>()({
    customId,
    values,
    guild,
    message: { id: "m1" },
    memberPermissions: { has: (p: bigint) => canManage && p === PermissionFlagsBits.ManageGuild },
    ...interactionKind(kind),
    replied: false,
    deferred: false,
    repliedWith: null as unknown,
    updatedWith: null as Payload | null,
    async reply(payload: unknown) {
      ix.repliedWith = payload;
    },
    async update(payload: Payload) {
      ix.updatedWith = payload;
    },
  });
  return ix;
}

const run = async (ix: ReturnType<typeof fakeInteraction>) => {
  await interactionCreate.execute(fakeBot(), ix);
  return ix;
};
const render = async () => ({ components: [await panel(guild)] });

test("한 화면에 세 부분. 컴포넌트 40 · 글자 4000 한도 안", async () => {
  const shown = await render();
  const text = textOf(shown);
  assert.match(text, /### .*서버 설정/);
  assert.match(text, /DJ 역할이 없어 \*\*모두\*\*/);
  assert.match(text, /SponsorBlock 자동 건너뛰기\*\*\n현재 설정: \*\*켬\*\*/);
  assert.match(text, /연령 제한 콘텐츠/);
  assert.deepEqual(
    buttonsOf(shown).map((b) => b.custom_id),
    ["setting:sb-toggle", "setting:age-channel", "setting:age-all"],
  );
  assert.ok(countOf(shown) <= 40, `컴포넌트 ${countOf(shown)}`);
  assert.ok([...text].length <= 4000);
});

test("봇 전체에서 SponsorBlock · 연령 제한 콘텐츠를 껐으면 그 부분이 없다", async () => {
  config.sponsorblock.enabled = false;
  documents._use("age-content", { enabled: false, changedAt: 2 });
  const shown = await render();
  assert.doesNotMatch(textOf(shown), /SponsorBlock|연령 제한/);
  assert.deepEqual(buttonsOf(shown), []);
  assert.equal(screenOf(shown).rows, 1, "역할 메뉴 줄만");
});

test("역할 메뉴: 고르면 바로 저장하고 화면을 다시 그린다. 서버에 없는 역할은 빼고, 비우면 푼다", async () => {
  const picked = await run(fakeInteraction("roleSelect", "setting:dj", { values: ["r1", "gone"] }));
  assert.deepEqual(settings.table.getDjRoles("g1"), ["r1"]);
  assert.deepEqual(screenOf(picked.updatedWith).roles, ["r1"]);
  assert.match(textOf(picked.updatedWith), /현재 DJ 역할: <@&r1>/);

  await run(fakeInteraction("roleSelect", "setting:dj", { values: [] }));
  assert.deepEqual(settings.table.getDjRoles("g1"), []);
});

test("SponsorBlock: 켜기 · 끄기 버튼과 구간 메뉴가 바로 저장한다. 끄면 구간 메뉴는 고를 수 없다", async () => {
  const off = await run(fakeInteraction("button", "setting:sb-toggle"));
  assert.equal(settings.resolveSponsorBlock("g1").enabled, false);
  assert.match(textOf(off.updatedWith), /현재 설정: \*\*끔\*\*/);
  assert.equal((selectOf(off.updatedWith!) as { disabled?: boolean } | undefined)?.disabled, true);

  await run(fakeInteraction("button", "setting:sb-toggle"));
  const cats = await run(fakeInteraction("select", "setting:sb-cats", { values: ["intro", "nope"] }));
  assert.deepEqual(settings.resolveSponsorBlock("g1"), { enabled: true, categories: ["intro"] });
  assert.deepEqual(
    selectOf(cats.updatedWith!)
      ?.options?.filter((o) => (o as { default?: boolean }).default)
      .map((o) => o.value),
    ["intro"],
  );
});

test("연령 제한 콘텐츠: 고른 쪽이 색 버튼, 모든 채널이면 경고 줄. 화면을 띄운 뒤 운영자가 껐으면 저장하지 않고 그 부분 없이 다시 그린다", async () => {
  const all = await run(fakeInteraction("button", "setting:age-all"));
  assert.equal(settings.resolveAgePlace("g1"), "all");
  const styles = Object.fromEntries(buttonsOf(all.updatedWith!).map((b) => [b.custom_id, b.style]));
  assert.deepEqual([styles["setting:age-all"], styles["setting:age-channel"]], [1, 2], "Primary · Secondary");
  assert.match(textOf(all.updatedWith), /모든 음성 채널에서 연령 제한이 걸린 곡을 재생할 수 있어요/);

  documents._use("age-content", { enabled: false, changedAt: 3 });
  const late = await run(fakeInteraction("button", "setting:age-channel"));
  assert.equal(settings.resolveAgePlace("g1"), "all", "저장하지 않는다");
  assert.doesNotMatch(textOf(late.updatedWith), /연령 제한/);
});

test("서버 관리 권한이 없으면 거절하고 저장하지 않는다", async () => {
  const ix = await run(fakeInteraction("button", "setting:age-all", { canManage: false }));
  assert.match(textOf(ix.repliedWith), /서버 관리 권한/);
  assert.equal(settings.resolveAgePlace("g1"), "channel");
});
