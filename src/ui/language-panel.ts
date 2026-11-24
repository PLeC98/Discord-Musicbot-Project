// /language 패널: 내 언어(누구나)와 서버 언어(서버 관리자에게만). 고르면 바로 저장하고 새 개인 언어로 다시 그린다(discord/interactions/language-handler).
// 언어 이름은 그 언어로 쓴 이름이다. T는 보는 사람의 문구표(본인에게만 보이는 패널)

import { ActionRowBuilder, StringSelectMenuBuilder, TextDisplayBuilder } from "discord.js";
import { frame } from "./frame.ts";
import { LANGUAGE, customId } from "./custom-ids.ts";
import { infoOf, type Language, type LanguageInfo } from "../rules/languages.ts";
import type { UserLanguage } from "../store/user-settings.ts";
import type { BotText } from "./text/index.ts";

/** 내 언어 메뉴의 자동 값 */
const AUTO = "auto";
/** 서버 언어 메뉴의 봇 기본 언어를 따름 값 */
const FOLLOW_BOT = "bot";

/**
 * 그릴 것. mine: 고른 개인 언어(정한 적 없으면 null), auto: 자동으로 풀린 언어, languages: 쓸 수 있는 언어.
 * guild: 서버 언어 부분(서버 관리자가 서버에서 열었을 때만). chosen: 서버가 고른 언어(따름이면 null), bot: 지금 봇 기본 언어
 */
type LanguagePanel = { mine: UserLanguage | null; auto: Language; languages: readonly LanguageInfo[]; guild: { chosen: Language | null; bot: Language } | null };

const menu = (id: string, placeholder: string, options: Array<{ label: string; value: string; default: boolean }>) => new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(customId(LANGUAGE, id)).setPlaceholder(placeholder).addOptions(options));

/** 패널 한 화면 */
function languagePanel(T: BotText, { mine, auto, languages, guild }: LanguagePanel) {
  const t = T.language.panel();
  const container = frame({ icon: "web", title: t.title, body: `**${t.mine}**\n${t.mineAbout}` });
  const chosen = mine === null || mine === AUTO ? AUTO : mine;
  container.addActionRowComponents(menu("me", t.minePlaceholder, [{ label: T.language.auto(infoOf(auto).name), value: AUTO, default: chosen === AUTO }, ...languages.map((one) => ({ label: one.name, value: one.tag, default: chosen === one.tag }))]));
  if (guild) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${t.server}**\n${t.serverAbout}`));
    container.addActionRowComponents(menu("guild", t.serverPlaceholder, [{ label: T.language.followBot(infoOf(guild.bot).name), value: FOLLOW_BOT, default: guild.chosen === null }, ...languages.map((one) => ({ label: one.name, value: one.tag, default: guild.chosen === one.tag }))]));
  }
  return container;
}

export { languagePanel, AUTO, FOLLOW_BOT };
export type { LanguagePanel };
