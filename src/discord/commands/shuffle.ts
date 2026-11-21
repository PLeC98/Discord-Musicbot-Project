import { SlashCommandBuilder } from "discord.js";
import { answerShuffle } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj" },
  name: "shuffle",
  data: (C) => new SlashCommandBuilder().setName("shuffle").setDescription(C.shuffle.description),

  async execute(interaction, bot) {
    await answerShuffle(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
