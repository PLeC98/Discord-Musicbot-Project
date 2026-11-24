import { SlashCommandBuilder } from "discord.js";
import { answerStop } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  name: "stop",
  data: (C) => new SlashCommandBuilder().setName("stop").setDescription(C.stop.description),

  async execute(interaction, bot) {
    await answerStop(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
