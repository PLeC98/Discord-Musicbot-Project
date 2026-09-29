import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as controlText from "../src/ui/text/controls.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("replay").setDescription("Restart the current track from the beginning").setDescriptionLocalizations({ ko: "현재 곡을 처음부터 재생합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.replay(client.players.get(guild.id), { member }, { onAccepted: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }) });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    const t = controlText.replayed(r.track);
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setDescription(t.description)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: t.by, value: `${member}`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.editReply({ embeds: [embed] });
  },
};
export default exported;
