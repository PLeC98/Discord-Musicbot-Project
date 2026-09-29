import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as controlText from "../src/ui/text/controls.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback and disconnect from voice channel").setDescriptionLocalizations({ ko: "재생을 정지하고 음성 채널에서 퇴장합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.stop(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    const t = controlText.stopped(r.track, r.cleared);
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setDescription(t.description)
      .setColor(colorOf("closed"))
      .setTimestamp()
      .addFields({ name: t.by, value: `${member}`, inline: true });

    if (t.footer) embed.setFooter({ text: t.footer });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
