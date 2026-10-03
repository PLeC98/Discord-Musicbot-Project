import { SlashCommandBuilder } from "discord.js";
import { answerPrevious } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous track").setDescriptionLocalizations({ ko: "이전 곡으로 되돌아가요" }),

  async execute(interaction, bot) {
    await answerPrevious(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
