// /language: 내 언어(누구나)와 서버 언어(서버 관리자에게만)를 고르는 패널을 본인에게만. DM에서도 쓴다(내 언어만).
// 쓸 수 있는 언어가 둘 이상일 때만 켠다. 고르는 것은 discord/interactions/language-handler가 받는다

import { SlashCommandBuilder, type ChatInputCommandInteraction, type StringSelectMenuInteraction } from "discord.js";
import type { AnywhereCommand } from "../../app/command-loader.ts";
import { isAvailable, type Language } from "../../rules/languages.ts";
import * as guildSettings from "../../store/guild-settings.ts";
import * as userSettings from "../../store/user-settings.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";
import { reply } from "../../ui/frame.ts";
import { autoLanguage, botLanguage, languagesNow, privateText } from "../../ui/language.ts";
import { languagePanel, type LanguagePanel } from "../../ui/language-panel.ts";
import { isServerManager } from "../../usecases/permissions.ts";

/** 패널을 연 상호작용(명령, 패널의 메뉴) */
type Opener = ChatInputCommandInteraction | StringSelectMenuInteraction;

/** 지금 값으로 그릴 것. 서버 언어 부분은 서버 관리자가 서버에서 열었을 때만. 쓸 수 없게 된 저장 값은 고르지 않은 것으로 표시한다 */
function panelOf(interaction: Opener): LanguagePanel {
  const languages = languagesNow();
  const shown = (tag: string | null): Language | null => (tag !== null && isAvailable(tag, languages) ? tag : null);
  const mine = userSettings.languageOf(interaction.user.id);
  const guild = interaction.inCachedGuild() && isServerManager(interaction.member) ? { chosen: shown(guildSettings.resolveLanguage(interaction.guildId)), bot: botLanguage() } : null;
  return { mine: mine === "auto" ? mine : shown(mine), auto: autoLanguage(interaction), languages, guild };
}

/** 패널 한 화면. 보는 사람의 문구표로 그린다(고른 뒤에는 새 개인 언어) */
const panelView = (interaction: Opener) => languagePanel(privateText(interaction), panelOf(interaction));

const exported: AnywhereCommand = {
  help: { section: "channel", tier: "everyone" },
  anywhere: true,
  name: "language",
  enabled: () => languagesNow().length > 1,
  data: (C) => new SlashCommandBuilder().setName("language").setDescription(C.language.description),

  async execute(interaction) {
    await toSelf(interaction, reply(panelView(interaction)), LIFETIME.screen);
  },
};
export default exported;
export { panelView };
