// /help: 첫 화면(분류마다의 설명)과 분류 메뉴. 분류를 고르거나 /help 분류: 로 그 분류의 명령 줄을 보이고, 뒤로 버튼으로 첫 화면에 돌아온다(discord/interactions/help).
// 본인에게만 보이는 화면이라 줄마다 보는 사람이 그 명령을 쓸 수 있는지 자물쇠로 표시한다

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { GuildCommand, SlashCommand } from "../../app/command-loader.ts";
import type { BotContext } from "../../app/bot-context.ts";
import * as helpText from "../../ui/text/ko/help.ts";
import { helpSections, SECTIONS, type HelpSection, type Open } from "../../ui/help-lines.ts";
import { commandMention } from "../../ui/command-mentions.ts";
import { frame, reply } from "../../ui/frame.ts";
import { buttonEmoji } from "../../ui/icons.ts";
import { HELP, customId } from "../../ui/custom-ids.ts";
import { dashboardButton } from "../../ui/dashboard-link.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";
import { helpAccess } from "../../usecases/help-access.ts";

type Commands = BotContext["commands"];
type Shown = ReturnType<typeof helpSections>;

const OPTION = "category";

/** 슬래시 명령의 정의(이 봇의 명령은 모두 슬래시라 설명이 있다) */
const definedOf = (command: SlashCommand) => command.data.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody;

const sectionsOf = (commands: Commands, guildId: string | null, open?: Open) =>
  helpSections(
    [...commands.values()].map((command) => ({ defined: definedOf(command), help: command.help })),
    guildId,
    open,
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
  const sections = sectionsOf(commands, guildId);
  const t = helpText.home({ play: commandMention("play", guildId), help: commandMention("help", guildId), sections: sections.map(({ key }) => key) });
  const container = frame({ icon: "music", title: t.title, body: t.lines.join("\n"), footer: [t.footer], divider: true });
  container.addActionRowComponents(sectionMenu(sections, null));
  const button = dashboardButton(helpText.controls().dashboard);
  if (button) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
  return container;
}

/** 한 분류의 명령 줄. open 은 보는 사람의 판정. 그 분류에 켜진 명령이 없으면(메뉴를 그린 뒤 꺼졌다) 첫 화면 */
function sectionView(commands: Commands, key: string, guildId: string | null = null, open?: Open) {
  const sections = sectionsOf(commands, guildId, open);
  const shown = sections.find((one) => one.key === key);
  if (!shown) return homeView(commands, guildId);
  const { icon, name } = helpText.section(shown.key);
  const container = frame({ icon, title: name, body: shown.lines.join("\n"), footer: helpText.legend(shown.tiers, shown.locked), divider: true });
  container.addActionRowComponents(sectionMenu(sections, shown.key));
  const back = new ButtonBuilder().setCustomId(customId(HELP, "home")).setLabel(helpText.controls().back).setStyle(ButtonStyle.Secondary);
  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(back));
  return container;
}

const controls = helpText.controls();

const exported: GuildCommand = {
  help: null,
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("명령어 목록과 쓰는 법을 알려줘요")
    .addStringOption((option) =>
      option
        .setName(OPTION)
        .setNameLocalizations({ ko: controls.option })
        .setDescription(controls.optionDescription)
        .addChoices(SECTIONS.map((key) => ({ name: helpText.section(key).name, value: key }))),
    ),

  async execute(interaction, bot) {
    const key = interaction.options.getString(OPTION);
    const view = key ? sectionView(bot.commands, key, interaction.guildId, await helpAccess(interaction.member)) : homeView(bot.commands, interaction.guildId);
    await toSelf(interaction, reply(view), LIFETIME.screen);
  },
};
export default exported;
export { homeView, sectionView };
