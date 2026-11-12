// /help: 첫 화면(시작하는 법)과 분류 메뉴. 메뉴로 고른 분류의 명령 줄을 보이고, 뒤로 버튼으로 첫 화면에 돌아온다(discord/interactions/help)

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { GuildCommand, SlashCommand } from "../../app/command-loader.ts";
import type { BotContext } from "../../app/bot-context.ts";
import * as helpText from "../../ui/text/ko/help.ts";
import { helpSections, type HelpSection } from "../../ui/help-lines.ts";
import { commandMention } from "../../ui/command-mentions.ts";
import { frame, reply } from "../../ui/frame.ts";
import { buttonEmoji } from "../../ui/icons.ts";
import { HELP, customId } from "../../ui/custom-ids.ts";
import { dashboardButton } from "../../ui/dashboard-link.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";

type Commands = BotContext["commands"];
type Shown = ReturnType<typeof helpSections>;

/** 슬래시 명령의 정의(이 봇의 명령은 모두 슬래시라 설명이 있다) */
const definedOf = (command: SlashCommand) => command.data.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody;

const sectionsOf = (commands: Commands, guildId: string | null) =>
  helpSections(
    [...commands.values()].map((command) => ({ defined: definedOf(command), help: command.help })),
    guildId,
  );

/** 분류 메뉴. 명령이 있는 섹션만, current 는 지금 보는 섹션 */
function sectionMenu(sections: Shown, current: HelpSection | null) {
  const options = sections.map(({ key }) => {
    const { icon, name } = helpText.section(key);
    return new StringSelectMenuOptionBuilder()
      .setLabel(name)
      .setValue(key)
      .setEmoji(buttonEmoji(icon))
      .setDefault(key === current);
  });
  const menu = new StringSelectMenuBuilder().setCustomId(customId(HELP, "section")).setPlaceholder(helpText.controls().placeholder).addOptions(options);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function homeView(commands: Commands, guildId: string | null = null) {
  const button = dashboardButton(helpText.controls().dashboard);
  const t = helpText.home({ play: commandMention("play", guildId), dashboard: button !== null });
  const container = frame({ icon: "music", title: t.title, body: t.lines.join("\n") });
  container.addActionRowComponents(sectionMenu(sectionsOf(commands, guildId), null));
  if (button) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
  return container;
}

/** 한 분류의 명령 줄. 그 분류에 켜진 명령이 없으면(메뉴를 그린 뒤 꺼졌다) 첫 화면 */
function sectionView(commands: Commands, key: string, guildId: string | null = null) {
  const sections = sectionsOf(commands, guildId);
  const shown = sections.find((one) => one.key === key);
  if (!shown) return homeView(commands, guildId);
  const { icon, name } = helpText.section(shown.key);
  const container = frame({ icon, title: name, body: shown.lines.join("\n"), footer: helpText.legend(shown.tiers), divider: true });
  container.addActionRowComponents(sectionMenu(sections, shown.key));
  const back = new ButtonBuilder().setCustomId(customId(HELP, "home")).setLabel(helpText.controls().back).setStyle(ButtonStyle.Secondary);
  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(back));
  return container;
}

const exported: GuildCommand = {
  help: null,
  data: new SlashCommandBuilder().setName("help").setDescription("명령어 목록과 쓰는 법을 알려줘요"),

  async execute(interaction, bot) {
    await toSelf(interaction, reply(homeView(bot.commands, interaction.guildId)), LIFETIME.screen);
  },
};
export default exported;
export { homeView, sectionView };
