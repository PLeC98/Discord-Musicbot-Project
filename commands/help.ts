import { formatSpan } from "../src/ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { Client } from "discord.js";
import { HELP, customId } from "../src/ui/customIds.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as helpText from "../src/ui/text/ko/help.ts";
import { helpSections } from "../src/ui/helpLines.ts";
import { LIFETIME, selfOnly, toSelf } from "../src/ui/delivery.ts";

async function buildHelpEmbed(client: Client<true>) {
  const guilds = client.guilds.cache.size;
  const users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
  const activeServers = client.players.size;

  const intro = helpText.intro();
  const embed = new EmbedBuilder().setTitle(intro.title).setDescription(intro.description).setColor(colorOf("brand")).setThumbnail(client.user.displayAvatarURL()).setTimestamp();
  // 명령 줄은 실행 목록(켜진 명령만, 등록 목록의 차례)에서 만든다
  const commands = [...client.commands.values()].map((command) => ({ defined: command.data.toJSON(), help: command.help }));
  for (const { name, lines } of helpSections(commands)) embed.addFields({ name, value: lines.join("\n"), inline: false });
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
  if (config.bot.website) buttons.push(new ButtonBuilder().setLabel(labels.website).setEmoji("🌐").setURL(config.bot.website).setStyle(ButtonStyle.Link));
  buttons.push(new ButtonBuilder().setCustomId(customId(HELP, "refresh")).setLabel(labels.refresh).setEmoji("🔄").setStyle(ButtonStyle.Secondary));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  return { embed, row };
}

const exported: GuildCommand = {
  help: null,
  data: new SlashCommandBuilder().setName("help").setDescription("Show all commands").setDescriptionLocalizations({ ko: "모든 명령어 목록을 알려줘요" }),

  async execute(interaction, client) {
    const { embed, row } = await buildHelpEmbed(client);
    await toSelf(interaction, selfOnly({ embeds: [embed], components: [row] }), LIFETIME.screen);
  },
};
export default exported;
export { buildHelpEmbed };
