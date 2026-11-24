// src/ui/language.ts: 누가 보는가로 언어를 고른다. 공개는 서버 언어 → 봇 기본 언어, 본인 답은 개인 언어 → 앱 언어 → 서버 언어 → 봇 기본 언어,
// 기존 메시지를 수정하면 그 메시지의 독자. 저장한 언어가 지금 쓸 수 없으면 다음 순서로

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import config from "../../src/config/index.ts";
import { audienceLanguage, autoLanguage, botLanguage, guildLanguage, personLanguage, readingTexts, viewerLanguage } from "../../src/ui/language.ts";
import { textFor } from "../../src/ui/text/index.ts";
import { TEST_LANGUAGE, useTestLanguage } from "../../src/rules/languages.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";
import * as userSettings from "../../src/store/user-settings.ts";
import { openTempStore } from "../helpers/temp-store.ts";

const store = openTempStore("language-");
after(() => store.close());

const savedBot = config.i18n.botLanguage;
afterEach(() => {
  useTestLanguage(false);
  config.i18n.botLanguage = savedBot;
});

const GUILD = "111111111111111111";
const OTHER = "222222222222222222";
const USER = "333333333333333333";
const message = (ephemeral: boolean) => ({ flags: { has: (flag: MessageFlags) => ephemeral && flag === MessageFlags.Ephemeral } });

test("아무것도 정하지 않았으면 모두 봇 기본 언어(한국어)", () => {
  assert.equal(guildLanguage(GUILD), "ko");
  assert.equal(personLanguage({ locale: "en-US", guildId: GUILD, user: { id: USER } }), "ko");
  assert.equal(viewerLanguage({ acceptLanguage: "en-US,en" }), "ko");
});

test("공개: 서버가 고른 언어 → 봇 기본 언어. 봇 기본 언어를 바꾸면 고르지 않은 서버만 따라간다", () => {
  useTestLanguage(true);
  guildSettings.setLanguage(GUILD, TEST_LANGUAGE);
  assert.equal(guildLanguage(GUILD), TEST_LANGUAGE);
  assert.equal(guildLanguage(OTHER), "ko");
  config.i18n.botLanguage = TEST_LANGUAGE;
  assert.equal(guildLanguage(OTHER), TEST_LANGUAGE);
  guildSettings.setLanguage(GUILD, "ko");
  assert.equal(guildLanguage(GUILD), "ko", "봇 기본 언어와 다른 언어를 고른 서버는 그대로");
  guildSettings.setLanguage(GUILD, null);
});

test("본인 답: 개인 언어(언어일 때) → 앱 언어(지원할 때) → 서버 언어 → 봇 기본 언어. 자동(정한 적 없음, 직접 고른 자동)은 개인 언어를 건너뛴다", () => {
  useTestLanguage(true);
  guildSettings.setLanguage(GUILD, TEST_LANGUAGE);
  const asker = (locale: string) => ({ locale, guildId: GUILD, user: { id: USER } });
  assert.equal(personLanguage(asker("ko")), "ko", "앱 언어");
  assert.equal(personLanguage(asker("en-US")), TEST_LANGUAGE, "앱 언어를 지원하지 않으면 서버 언어");
  assert.equal(personLanguage({ locale: "en-US", guildId: null, user: { id: USER } }), "ko", "서버 밖이면 봇 기본 언어");
  userSettings.setLanguage(USER, TEST_LANGUAGE);
  assert.equal(personLanguage(asker("ko")), TEST_LANGUAGE, "개인 언어가 앱 언어보다 먼저");
  assert.equal(autoLanguage(asker("ko")), "ko", "자동으로 풀린 언어는 개인 언어를 보지 않는다");
  userSettings.setLanguage(USER, "auto");
  assert.equal(personLanguage(asker("ko")), "ko", "직접 고른 자동");
  userSettings.setLanguage(USER, null);
  assert.equal(personLanguage(asker("ko")), "ko", "정한 적 없음");
  guildSettings.setLanguage(GUILD, null);
});

test("저장한 언어가 지금 쓸 수 없으면(테스트 언어를 껐다) 다음 순서로", () => {
  useTestLanguage(true);
  guildSettings.setLanguage(GUILD, TEST_LANGUAGE);
  userSettings.setLanguage(USER, TEST_LANGUAGE);
  config.i18n.botLanguage = TEST_LANGUAGE;
  useTestLanguage(false);
  assert.equal(botLanguage(), "ko", "봇 기본 언어는 기준 언어로");
  assert.equal(guildLanguage(GUILD), "ko");
  assert.equal(personLanguage({ locale: "ko", guildId: GUILD, user: { id: USER } }), "ko");
  guildSettings.setLanguage(GUILD, null);
  userSettings.setLanguage(USER, null);
});

test("기존 메시지를 수정할 때: 공개 메시지면 서버 언어, 본인에게만 보이는 메시지나 메시지가 없으면 그 사람의 언어", () => {
  useTestLanguage(true);
  guildSettings.setLanguage(GUILD, TEST_LANGUAGE);
  assert.equal(audienceLanguage({ locale: "ko", guildId: GUILD, message: message(false) }), TEST_LANGUAGE);
  assert.equal(audienceLanguage({ locale: "ko", guildId: GUILD, message: message(true) }), "ko");
  assert.equal(audienceLanguage({ locale: "ko", guildId: GUILD }), "ko");
  guildSettings.setLanguage(GUILD, null);
});

test("대시보드: 개인 언어(로그인했을 때) → Accept-Language에서 지원하는 언어 → 봇 기본 언어", () => {
  useTestLanguage(true);
  assert.equal(viewerLanguage({ acceptLanguage: "qps-ploc, ko;q=0.5" }), TEST_LANGUAGE);
  assert.equal(viewerLanguage({ acceptLanguage: "en-US" }), "ko");
  assert.equal(viewerLanguage({}), "ko");
  userSettings.setLanguage(USER, TEST_LANGUAGE);
  assert.equal(viewerLanguage({ userId: USER, acceptLanguage: "ko" }), TEST_LANGUAGE);
  userSettings.setLanguage(USER, null);
});

test("되읽기: 그 사람의 언어부터 쓸 수 있는 모든 언어의 문구표를 차례로", () => {
  assert.deepEqual(readingTexts({ locale: "ko", guildId: GUILD }), [textFor("ko")]);
  useTestLanguage(true);
  guildSettings.setLanguage(GUILD, TEST_LANGUAGE);
  assert.deepEqual(readingTexts({ locale: "en-US", guildId: GUILD }), [textFor(TEST_LANGUAGE), textFor("ko")]);
  assert.deepEqual(readingTexts({ locale: "ko", guildId: GUILD }), [textFor("ko"), textFor(TEST_LANGUAGE)]);
  guildSettings.setLanguage(GUILD, null);
});
