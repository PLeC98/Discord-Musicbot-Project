// src/ui/language.ts: 누가 보는가로 언어를 고른다. 공개는 서버 언어, 본인 답은 앱 언어 → 서버 언어 → 봇 기본 언어, 기존 메시지를 수정하면 그 메시지의 독자

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import config from "../../src/config/index.ts";
import { audienceLanguage, guildLanguage, personLanguage, readingTexts, viewerLanguage } from "../../src/ui/language.ts";
import { textFor } from "../../src/ui/text/index.ts";
import { TEST_LANGUAGE } from "../../src/rules/languages.ts";

const savedGuildId = config.discord.guildId;
afterEach(() => {
  config.i18n.testLanguage = false;
  config.discord.guildId = savedGuildId;
});

// 테스트 언어는 GUILD_ID가 없으면 모든 서버에 적용된다
const onEverywhere = () => {
  config.i18n.testLanguage = true;
  config.discord.guildId = null;
};

const message = (ephemeral: boolean) => ({ flags: { has: (flag: MessageFlags) => ephemeral && flag === MessageFlags.Ephemeral } });

test("테스트 언어를 끄면 모두 한국어", () => {
  assert.equal(guildLanguage("g"), "ko");
  assert.equal(personLanguage({ locale: "en-US", guildId: "g" }), "ko");
  assert.equal(viewerLanguage({ acceptLanguage: "en-US,en" }), "ko");
});

test("본인 답: 앱 언어를 지원하면 그 언어, 아니면 서버 언어, 서버 밖이면 봇 기본 언어", () => {
  onEverywhere();
  assert.equal(guildLanguage("g"), TEST_LANGUAGE);
  assert.equal(personLanguage({ locale: "ko", guildId: "g" }), "ko");
  assert.equal(personLanguage({ locale: "en-US", guildId: "g" }), TEST_LANGUAGE);
  assert.equal(personLanguage({ locale: "en-US", guildId: null }), "ko");
});

test("기존 메시지를 수정할 때: 공개 메시지면 서버 언어, 본인에게만 보이는 메시지나 메시지가 없으면 그 사람의 언어", () => {
  onEverywhere();
  assert.equal(audienceLanguage({ locale: "ko", guildId: "g", message: message(false) }), TEST_LANGUAGE);
  assert.equal(audienceLanguage({ locale: "ko", guildId: "g", message: message(true) }), "ko");
  assert.equal(audienceLanguage({ locale: "ko", guildId: "g" }), "ko");
});

test("대시보드: Accept-Language에서 지원하는 언어를 찾고 없으면 봇 기본 언어", () => {
  onEverywhere();
  assert.equal(viewerLanguage({ acceptLanguage: "qps-ploc, ko;q=0.5" }), TEST_LANGUAGE);
  assert.equal(viewerLanguage({ acceptLanguage: "en-US" }), "ko");
  assert.equal(viewerLanguage({}), "ko");
});

test("GUILD_ID가 있으면 테스트 언어는 그 서버에만 적용된다", () => {
  config.i18n.testLanguage = true;
  config.discord.guildId = "111111111111111111";
  assert.equal(guildLanguage("111111111111111111"), TEST_LANGUAGE);
  assert.equal(guildLanguage("222222222222222222"), "ko");
  assert.equal(personLanguage({ locale: "en-US", guildId: "222222222222222222" }), "ko");
});

test("되읽기: 그 사람의 언어부터 쓸 수 있는 모든 언어의 문구표를 차례로", () => {
  assert.deepEqual(readingTexts({ locale: "ko", guildId: "g" }), [textFor("ko")]);
  onEverywhere();
  assert.deepEqual(readingTexts({ locale: "en-US", guildId: "g" }), [textFor(TEST_LANGUAGE), textFor("ko")]);
  assert.deepEqual(readingTexts({ locale: "ko", guildId: "g" }), [textFor("ko"), textFor(TEST_LANGUAGE)]);
});
