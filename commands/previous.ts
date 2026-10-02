import { SlashCommandBuilder } from "discord.js";
import { answerPrevious } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous track").setDescriptionLocalizations({ ko: "이전 곡으로 되돌아가요" }),

  async execute(interaction, client) {
    await answerPrevious(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
