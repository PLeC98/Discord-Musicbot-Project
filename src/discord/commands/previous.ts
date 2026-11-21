import { SlashCommandBuilder } from "discord.js";
import { answerPrevious } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  name: "previous",
  data: (C) => new SlashCommandBuilder().setName("previous").setDescription(C.previous.description),

  async execute(interaction, bot) {
    await answerPrevious(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
