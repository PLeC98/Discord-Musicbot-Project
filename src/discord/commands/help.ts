// /help: 명령 요약 한 장. 명령 이름을 주면 그 명령 하나를 자세히(입력, 쓸 수 있는 사람, 지금 그 사람이 쓸 수 있는지)

import { ActionRowBuilder, SlashCommandBuilder, type APIApplicationCommandOption, type ButtonBuilder, type GuildMember, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { GuildCommand, SlashCommand } from "../../app/command-loader.ts";
import type { BotContext } from "../../app/bot-context.ts";
import * as helpText from "../../ui/text/ko/help.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { helpSections, inHelpOrder } from "../../ui/help-lines.ts";
import { commandMention } from "../../ui/command-mentions.ts";
import { frame, reply } from "../../ui/frame.ts";
import { dashboardButton } from "../../ui/dashboard-link.ts";
import { LIFETIME, noticeSelf, toSelf } from "../../ui/delivery.ts";
import { DISCORD_LOOK } from "../../ui/mentions.ts";
import { gateOf, type GateContext } from "../../usecases/command-gate.ts";
import * as GuildSettingsManager from "../../store/guild-settings.ts";

const OPTION = "command";

/** 슬래시 명령의 정의(이 봇의 명령은 모두 슬래시라 설명이 있다) */
const definedOf = (command: SlashCommand) => command.data.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody;

/** 켜진 명령을 도움말 순서로 */
const listed = (commands: BotContext["commands"]) => inHelpOrder([...commands.values()].map((command) => ({ defined: definedOf(command), help: command.help, command })));

function summaryView(commands: BotContext["commands"], guildId: string | null = null) {
  const intro = helpText.intro(commandMention("play", guildId));
  const sections = helpSections(
    [...commands.values()].map((command) => ({ defined: definedOf(command), help: command.help })),
    guildId,
  );
  const body = [...intro.lines, ...sections.map((section) => `\n**${section.name}**\n${section.lines.join("\n")}`)].join("\n");
  const container = frame({ icon: "music", title: intro.title, body, footer: [helpText.footer(commandMention("help", guildId))], divider: true });
  const button = dashboardButton(helpText.buttons().dashboard);
  if (button) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
  return container;
}

/** 옵션의 보이는 이름과 설명(한국어가 있으면 그것) */
function optionLines(options: APIApplicationCommandOption[] | undefined): helpText.OptionLine[] {
  return (options ?? []).map((o) => ({ name: o.name_localizations?.ko ?? o.name, description: o.description_localizations?.ko ?? o.description, required: "required" in o && Boolean(o.required) }));
}

/** 그 사람이 지금 그 명령을 쓸 수 있는지 */
async function nowFor(command: SlashCommand, member: GuildMember, context: GateContext): Promise<helpText.Now> {
  if (!command.help) return { state: "yes" };
  const result = await gateOf(command.help)(member, context);
  if (result === null) return { state: "yes" };
  if (result === "own-track") return { state: "own-track" };
  return { state: "no", why: errors.noticeFor(result, { channelId: context.botChannelId ?? "" }, DISCORD_LOOK).body ?? "" };
}

async function detailView(command: SlashCommand, member: GuildMember, context: GateContext, guildId: string) {
  const defined = definedOf(command);
  const now = await nowFor(command, member, context);
  const view = helpText.detail({ mention: commandMention(defined.name, guildId), description: defined.description ?? "", options: optionLines(defined.options), tier: command.help?.tier ?? "everyone", now });
  return frame({ icon: "music", title: view.title, body: view.lines.join("\n"), footer: [helpText.detailFooter()], divider: true });
}

const exported: GuildCommand = {
  help: null,
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("명령어 목록과 쓰는 법을 알려줘요")
    .addStringOption((option) => option.setName(OPTION).setNameLocalizations({ ko: "명령" }).setDescription("자세히 볼 명령어").setAutocomplete(true)),

  async execute(interaction, bot) {
    const name = interaction.options.getString(OPTION)?.trim().replace(/^\//, "");
    if (!name) return toSelf(interaction, reply(summaryView(bot.commands, interaction.guildId)), LIFETIME.screen);
    const found = listed(bot.commands).find((one) => one.defined.name === name);
    if (!found) return noticeSelf(interaction, errors.notice("help-no-such-command"));
    const { guild } = interaction;
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    const context: GateContext = { player: bot.players.get(guild.id), botChannelId: botChannelId && guild.channels.cache.has(botChannelId) ? botChannelId : null, channelId: interaction.channelId };
    await toSelf(interaction, reply(await detailView(found.command, interaction.member, context, guild.id)), LIFETIME.screen);
  },

  // 이름이 입력으로 시작하는 것을 먼저, 그다음 이름이나 설명에 입력이 든 것. 비었으면 도움말 순서 그대로
  async autocomplete(interaction, bot) {
    const typed = interaction.options.getFocused().trim().replace(/^\//, "").toLowerCase();
    const all = listed(bot.commands).map(({ defined }) => ({ name: defined.name, description: defined.description ?? "" }));
    const starts = all.filter((one) => one.name.startsWith(typed));
    const contains = all.filter((one) => !one.name.startsWith(typed) && (one.name.includes(typed) || one.description.toLowerCase().includes(typed)));
    await interaction.respond([...starts, ...contains].slice(0, 25).map((one) => ({ name: helpText.choice(one.name, one.description), value: one.name })));
  },
};
export default exported;
export { summaryView, detailView };
