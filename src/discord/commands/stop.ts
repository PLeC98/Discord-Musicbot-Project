import { SlashCommandBuilder } from "discord.js";
import { answerStop } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback and disconnect from voice channel").setDescriptionLocalizations({ ko: "재생을 멈추고 음성 채널에서 나가요" }),

  async execute(interaction, client) {
    await answerStop(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
