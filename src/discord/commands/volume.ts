import { SlashCommandBuilder } from "discord.js";
import { answerVolume } from "../interactions/control-answers.ts";
import { VOLUME_MAX } from "../../rules/limits.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "mode", tier: "dj" },
  name: "volume",
  data: (C) =>
    new SlashCommandBuilder()
      .setName("volume")
      .setDescription(C.volume.description)
      .addIntegerOption((option) => option.setName("level").setDescription(C.volume.options.level.description).setRequired(true).setMinValue(0).setMaxValue(VOLUME_MAX)),

  async execute(interaction, bot) {
    await answerVolume(interaction, bot.players.get(interaction.guild.id), interaction.options.getInteger("level", true));
  },
};
export default exported;
