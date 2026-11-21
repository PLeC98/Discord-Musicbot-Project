// src/discord/commands/language.ts, interactions/language-handler.ts: /language 패널. 내 언어는 누구나(DM 포함), 서버 언어는 서버 관리자에게만.
// 고르면 바로 저장하고 새 개인 언어로 다시 그린다. 언어가 하나뿐이면 명령이 꺼진다. 저장은 임시 DB

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type StringSelectMenuInteraction } from "discord.js";
import { openTempStore } from "../helpers/temp-store.ts";
import { interactionKind } from "../helpers/interaction-kind.ts";
import { textOf } from "../helpers/cv2.ts";
import { command, run } from "../helpers/commands.ts";
import { TEST_LANGUAGE } from "../../src/rules/languages.ts";

const temp = openTempStore("language-panel-");
const config = (await import("../../src/config/index.ts")).default;
const guildSettings = await import("../../src/store/guild-settings.ts");
const userSettings = await import("../../src/store/user-settings.ts");
const { fakeWith, fakeBot } = await import("../helpers/fake.ts");
const interactionCreate = (await import("../../src/discord/events/interaction-create.ts")).default;
const language = await command("language");

after(() => {
  config.i18n.testLanguage = false;
  temp.close();
});
beforeEach(() => {
  config.i18n.testLanguage = true;
  guildSettings.setLanguage("g1", null);
  userSettings.setLanguage("u1", null);
});

type Payload = { components: Array<{ toJSON(): unknown }> };
type Node = { type: number; custom_id?: string; options?: Array<{ value: string; label: string; default?: boolean }>; components?: Node[] };
const HANGUL = /[가-힣]/;

// 패널 안의 메뉴들(custom_id → 선택지)
function menusOf(payload: Payload) {
  const out = new Map<string, NonNullable<Node["options"]>>();
  const walk = (n: Node) => {
    if (n.type === 3 && n.custom_id) out.set(n.custom_id, n.options ?? []);
    for (const c of n.components ?? []) walk(c);
  };
  for (const c of payload.components) walk(c.toJSON() as Node);
  return out;
}

// 명령. inGuild가 거짓이면 DM
function slash({ manager = true, inGuild = true, locale = "ko" } = {}) {
  const ix = {
    user: { id: "u1" },
    locale,
    guildId: inGuild ? "g1" : null,
    member: inGuild ? { permissions: { has: (p: bigint) => manager && p === PermissionFlagsBits.ManageGuild } } : null,
    inGuild: () => inGuild,
    inCachedGuild: () => inGuild,
    replied: false,
    deferred: false,
    repliedWith: null as Payload | null,
    async reply(payload: Payload) {
      ix.repliedWith = payload;
    },
  };
  return ix;
}

// 패널의 메뉴. inGuild가 거짓이면 DM의 메뉴(dmSelect)
function pick(customId: string, value: string, { manager = true, inGuild = true } = {}) {
  const ix = fakeWith<StringSelectMenuInteraction>()({
    ...interactionKind("select"),
    customId,
    values: [value],
    user: { id: "u1" },
    locale: "ko",
    guildId: inGuild ? "g1" : null,
    guild: inGuild ? { id: "g1", name: "서버" } : null,
    member: inGuild ? { permissions: { has: (p: bigint) => manager && p === PermissionFlagsBits.ManageGuild } } : null,
    message: { id: "m1", interactionMetadata: null },
    inGuild: () => inGuild,
    inCachedGuild: () => inGuild,
    replied: false,
    deferred: false,
    updatedWith: null as Payload | null,
    repliedWith: null as Payload | null,
    async update(payload: Payload) {
      ix.updatedWith = payload;
    },
    async reply(payload: Payload) {
      ix.repliedWith = payload;
    },
    async deleteReply() {},
  });
  return ix;
}

test("언어가 둘 이상일 때만 명령이 켜진다", () => {
  assert.equal(language.enabled?.(), true);
  config.i18n.testLanguage = false;
  assert.equal(language.enabled?.(), false);
});

test("서버 관리자는 내 언어와 서버 언어, 아니면 내 언어만, DM도 내 언어만. 자동과 봇 기본 언어에는 지금 풀린 언어를 보여 준다", async () => {
  const manager = slash();
  await run(language, manager);
  const menus = menusOf(manager.repliedWith!);
  assert.deepEqual([...menus.keys()], ["language:me", "language:guild"]);
  assert.deepEqual(
    menus.get("language:me")!.map((one) => [one.value, one.label, Boolean(one.default)]),
    [
      ["auto", "자동 (한국어)", true],
      ["ko", "한국어", false],
      [TEST_LANGUAGE, "Pseudo", false],
    ],
  );
  assert.deepEqual(
    menus.get("language:guild")!.map((one) => [one.value, Boolean(one.default)]),
    [
      ["bot", true],
      ["ko", false],
      [TEST_LANGUAGE, false],
    ],
  );
  assert.equal(menus.get("language:guild")![0].label, "봇 기본 언어를 따름 (한국어)");

  const member = slash({ manager: false });
  await run(language, member);
  assert.deepEqual([...menusOf(member.repliedWith!).keys()], ["language:me"]);
  const dm = slash({ inGuild: false });
  await run(language, dm);
  assert.deepEqual([...menusOf(dm.repliedWith!).keys()], ["language:me"]);
});

test("내 언어를 고르면 저장하고 그 언어로 다시 그린다. 자동을 고르면 직접 고른 자동으로 남는다. DM의 메뉴도 받는다", async () => {
  const chose = pick("language:me", TEST_LANGUAGE);
  await interactionCreate.execute(fakeBot(), chose);
  assert.equal(userSettings.languageOf("u1"), TEST_LANGUAGE);
  assert.equal(HANGUL.test(textOf(chose.updatedWith!)), false, "새 개인 언어로 그린다");
  assert.equal(
    menusOf(chose.updatedWith!)
      .get("language:me")
      ?.find((one) => one.default)?.value,
    TEST_LANGUAGE,
  );

  const auto = pick("language:me", "auto", { inGuild: false });
  await interactionCreate.execute(fakeBot(), auto);
  assert.equal(userSettings.languageOf("u1"), "auto", "DM에서도 저장한다");
  assert.ok(HANGUL.test(textOf(auto.updatedWith!)));
});

test("서버 언어: 서버 관리자만 고르고, 봇 기본 언어를 따름은 지운다. 모르는 값은 받지 않는다", async () => {
  await interactionCreate.execute(fakeBot(), pick("language:guild", TEST_LANGUAGE));
  assert.equal(guildSettings.resolveLanguage("g1"), TEST_LANGUAGE);
  await interactionCreate.execute(fakeBot(), pick("language:guild", "bot"));
  assert.equal(guildSettings.resolveLanguage("g1"), null);

  const refused = pick("language:guild", TEST_LANGUAGE, { manager: false });
  await interactionCreate.execute(fakeBot(), refused);
  assert.equal(guildSettings.resolveLanguage("g1"), null);
  assert.equal(refused.updatedWith, null);
  assert.ok(refused.repliedWith, "본인에게 거절을 알린다");

  const unknown = pick("language:me", "xx");
  await interactionCreate.execute(fakeBot(), unknown);
  assert.equal(userSettings.languageOf("u1"), null);
  assert.equal(unknown.updatedWith, null);
});
