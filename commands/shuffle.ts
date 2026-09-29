import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as controlText from "../src/ui/text/controls.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue").setDescriptionLocalizations({ ko: "대기열을 무작위로 섞습니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.shuffle(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    const t = controlText.shuffled(r.count);
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setDescription(t.description)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: t.by, value: `${member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
