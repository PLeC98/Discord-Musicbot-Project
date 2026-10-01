import { SlashCommandBuilder } from "discord.js";
import { answerPause } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause or resume the current track").setDescriptionLocalizations({ ko: "일시정지를 토글합니다" }),

  async execute(interaction, client) {
    await answerPause(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
