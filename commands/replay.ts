import { SlashCommandBuilder } from "discord.js";
import { answerReplay } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("replay").setDescription("Restart the current track from the beginning").setDescriptionLocalizations({ ko: "현재 곡을 처음부터 재생합니다" }),

  async execute(interaction, client) {
    await answerReplay(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
