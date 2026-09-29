import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as controlText from "../src/ui/text/controls.ts";
import * as labels from "../src/ui/text/labels.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a specific track from the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 특정 곡을 제거합니다" })
    .addIntegerOption((option) => option.setName("position").setDescription("Position in queue (e.g. 1 = next song)").setDescriptionLocalizations({ ko: "대기열 순서 (예: 1 = 다음 곡)" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    // 사람은 1부터 센다
    const r = await controls.remove(client.players.get(guild.id), { member }, interaction.options.getInteger("position", true) - 1);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    const t = controlText.removed(r.track);
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setDescription(t.description)
      .setColor(colorOf("brand"))
      .setTimestamp()
      .addFields({ name: t.by, value: `${member}`, inline: true }, { name: t.left, value: labels.trackCount(r.left), inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
export default exported;
