import { SlashCommandBuilder } from "discord.js";
import { answerShuffle } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  help: { section: "queue", tier: "dj" },
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue").setDescriptionLocalizations({ ko: "대기열을 무작위로 섞어요" }),

  async execute(interaction, client) {
    await answerShuffle(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
