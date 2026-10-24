import { formatSpan } from "../../ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import config from "../../config/index.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { Client } from "discord.js";
import type { BotContext } from "../../app/bot-context.ts";
import { HELP, customId } from "../../ui/custom-ids.ts";
import { colorOf } from "../../ui/colors.ts";
import { buttonEmoji } from "../../ui/icons.ts";
import * as helpText from "../../ui/text/ko/help.ts";
import { helpSections } from "../../ui/help-lines.ts";
import { LIFETIME, selfOnly, toSelf } from "../../ui/delivery.ts";

// players: 지금 도는 서버 수 · commands: 켜진 명령(실행 목록)
async function buildHelpEmbed(client: Client<true>, { players, commands }: Pick<BotContext, "players" | "commands">) {
  const guilds = client.guilds.cache.size;
  const users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  const activeServers = players.size;

  const intro = helpText.intro();
  const embed = new EmbedBuilder().setTitle(intro.title).setDescription(intro.description).setColor(colorOf("brand")).setThumbnail(client.user.displayAvatarURL()).setTimestamp();
  // 명령 줄은 실행 목록(켜진 명령만, 등록 목록의 순서)에서 만든다
  const defined = [...commands.values()].map((command) => ({ defined: command.data.toJSON(), help: command.help }));
  for (const { name, lines } of helpSections(defined)) embed.addFields({ name, value: lines.join("\n"), inline: false });
  const stats = helpText.stats({ guilds, users, active: activeServers, uptime: formatSpan(process.uptime()) });
  embed.addFields({ name: stats.name, value: stats.lines.join("\n"), inline: true });
  // WEBSITE는 선택 설정(null 허용). 없으면 링크/버튼을 생략한다
  const links = helpText.links({ invite: config.bot.invite, website: config.bot.website });
  embed.addFields({ name: links.name, value: links.lines.join("\n"), inline: true });
  embed.setFooter({
    text: client.user.username,
    iconURL: client.user.displayAvatarURL(),
  });
  const buttons: ButtonBuilder[] = [];
  const labels = helpText.buttons();
  if (config.bot.website) buttons.push(new ButtonBuilder().setLabel(labels.website).setEmoji(buttonEmoji("web")).setURL(config.bot.website).setStyle(ButtonStyle.Link));
  buttons.push(new ButtonBuilder().setCustomId(customId(HELP, "refresh")).setLabel(labels.refresh).setEmoji(buttonEmoji("refresh")).setStyle(ButtonStyle.Secondary));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  return { embed, row };
}

const exported: GuildCommand = {
  help: null,
  data: new SlashCommandBuilder().setName("help").setDescription("Show all commands").setDescriptionLocalizations({ ko: "모든 명령어 목록을 알려줘요" }),

  async execute(interaction, bot) {
    const { embed, row } = await buildHelpEmbed(interaction.client, bot);
    await toSelf(interaction, selfOnly({ embeds: [embed], components: [row] }), LIFETIME.screen);
  },
};
export default exported;
export { buildHelpEmbed };
