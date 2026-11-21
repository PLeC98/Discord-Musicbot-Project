import { SlashCommandBuilder } from "discord.js";
import { answerPause } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  name: "pause",
  data: (C) => new SlashCommandBuilder().setName("pause").setDescription(C.pause.description),

  async execute(interaction, bot) {
    await answerPause(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
