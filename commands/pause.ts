import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause or resume the current track").setDescriptionLocalizations({ ko: "일시정지를 토글합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.pause(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    const message = r.paused ? "음악 일시정지됨" : "음악 재개됨";
    const emoji = r.paused ? "⏸️" : "▶️";
    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${message}`)
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})** ${message}!`)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: "👤 작업자", value: `${member}`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
