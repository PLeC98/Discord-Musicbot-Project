import { SlashCommandBuilder } from "discord.js";
import { answerSkip } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj-or-requester" },
  name: "skip",
  data: (C) => new SlashCommandBuilder().setName("skip").setDescription(C.skip.description),

  async execute(interaction, bot) {
    await answerSkip(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
