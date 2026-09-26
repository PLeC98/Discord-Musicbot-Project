import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import { volumeChanged } from "../src/ui/volumeReply.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume")
    .setDescriptionLocalizations({ ko: "재생 볼륨을 설정합니다" })
    .addIntegerOption((option) => option.setName("level").setDescription("Volume level (0 ~ 100)").setDescriptionLocalizations({ ko: "볼륨 크기 (0 ~ 100)" }).setRequired(true).setMinValue(0).setMaxValue(100)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.volume(client.players.get(guild.id), { member }, interaction.options.getInteger("level", true));
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    await interaction.reply({ embeds: [volumeChanged({ before: r.before, level: r.level, by: member })], flags: [1 << 6] });
  },
};
export default exported;
