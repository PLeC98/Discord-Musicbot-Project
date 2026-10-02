import { SlashCommandBuilder } from "discord.js";
import { answerStop } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback and disconnect from voice channel").setDescriptionLocalizations({ ko: "재생을 멈추고 음성 채널에서 나가요" }),

  async execute(interaction, client) {
    await answerStop(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
