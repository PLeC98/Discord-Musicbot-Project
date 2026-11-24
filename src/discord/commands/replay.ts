import { SlashCommandBuilder } from "discord.js";
import { answerReplay } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  name: "replay",
  data: (C) => new SlashCommandBuilder().setName("replay").setDescription(C.replay.description),

  async execute(interaction, bot) {
    await answerReplay(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
