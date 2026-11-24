// /help: 첫 화면(분류마다의 설명)과 분류 메뉴. 분류를 고르거나 /help 분류: 로 그 분류의 명령 줄을 보이고, 뒤로 버튼으로 첫 화면에 돌아온다(discord/interactions/help).
// 본인에게만 보이는 화면이라 줄마다 보는 사람이 그 명령을 쓸 수 있는지 자물쇠로 표시한다

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import type { GuildCommand, SlashCommand } from "../../app/command-loader.ts";
import type { BotContext } from "../../app/bot-context.ts";
import { helpSections, SECTIONS, type HelpSection, type Open } from "../../ui/help-lines.ts";
import { commandMention } from "../../ui/command-mentions.ts";
import { frame, reply } from "../../ui/frame.ts";
import { buttonEmoji } from "../../ui/icons.ts";
import { HELP, customId } from "../../ui/custom-ids.ts";
import { dashboardButton } from "../../ui/dashboard-link.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";
import { helpAccess } from "../../usecases/help-access.ts";
import { privateText } from "../../ui/language.ts";
import type { BotText } from "../../ui/text/index.ts";

type Commands = BotContext["commands"];
type Shown = ReturnType<typeof helpSections>;

const OPTION = "category";

/** 명령의 이름과 보는 사람의 언어로 된 설명 */
const definedOf = (T: BotText, command: SlashCommand) => ({ name: command.name, description: (T.commands as Record<string, { description: string } | undefined>)[command.name]?.description });

const sectionsOf = (T: BotText, commands: Commands, guildId: string | null, open?: Open) =>
  helpSections(
    T,
    [...commands.values()].map((command) => ({ defined: definedOf(T, command), help: command.help })),
    guildId,
    open,
  );

/** 분류 메뉴. 명령이 있는 섹션만, current는 지금 보는 섹션 */
function sectionMenu(T: BotText, sections: Shown, current: HelpSection | null) {
  const options = sections.map(({ key }) => {
    const { icon, name } = T.help.section(key);
    return new StringSelectMenuOptionBuilder()
      .setLabel(name)
      .setValue(key)
      .setEmoji(buttonEmoji(icon))
      .setDefault(key === current);
  });
  const menu = new StringSelectMenuBuilder().setCustomId(customId(HELP, "section")).setPlaceholder(T.help.controls().placeholder).addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** 첫 화면. T는 보는 사람의 문구표(본인에게만 보이는 화면) */
function homeView(T: BotText, commands: Commands, guildId: string | null = null) {
  const sections = sectionsOf(T, commands, guildId);
  const t = T.help.home({ play: commandMention("play", guildId), help: commandMention("help", guildId), sections: sections.map(({ key }) => key) });
  const container = frame({ icon: "music", title: t.title, body: t.lines.join("\n"), footer: [t.footer], divider: true });
  container.addActionRowComponents(sectionMenu(T, sections, null));
  const button = dashboardButton(T.help.controls().dashboard);
  if (button) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
  return container;
}

/** 한 분류의 명령 줄. open은 보는 사람의 판정. 그 분류에 켜진 명령이 없으면(메뉴를 그린 뒤 꺼졌다) 첫 화면 */
function sectionView(T: BotText, commands: Commands, key: string, guildId: string | null = null, open?: Open) {
  const sections = sectionsOf(T, commands, guildId, open);
  const shown = sections.find((one) => one.key === key);
  if (!shown) return homeView(T, commands, guildId);
  const { icon, name } = T.help.section(shown.key);
  const container = frame({ icon, title: name, body: shown.lines.join("\n"), footer: T.help.legend(shown.tiers, shown.locked), divider: true });
  container.addActionRowComponents(sectionMenu(T, sections, shown.key));
  const back = new ButtonBuilder().setCustomId(customId(HELP, "home")).setLabel(T.help.controls().back).setStyle(ButtonStyle.Secondary);
  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(back));
  return container;
}

const exported: GuildCommand = {
  name: "help",
  help: null,
  data: (C) =>
    new SlashCommandBuilder()
      .setName("help")
      .setDescription(C.help.description)
      .addStringOption((option) =>
        option
          .setName(OPTION)
          .setDescription(C.help.options.category.description)
          .addChoices(SECTIONS.map((key) => ({ name: C.help.options.category.choices[key], value: key }))),
      ),

  async execute(interaction, bot) {
    const key = interaction.options.getString(OPTION);
    const T = privateText(interaction);
    const view = key ? sectionView(T, bot.commands, key, interaction.guildId, await helpAccess(interaction.member)) : homeView(T, bot.commands, interaction.guildId);
    await toSelf(interaction, reply(view), LIFETIME.screen);
  },
};
export default exported;
export { homeView, sectionView };
