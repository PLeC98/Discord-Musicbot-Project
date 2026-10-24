import { SlashCommandBuilder } from "discord.js";
import { answerReplay } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  data: new SlashCommandBuilder().setName("replay").setDescription("Restart the current track from the beginning").setDescriptionLocalizations({ ko: "현재 곡을 처음부터 재생해요" }),

  async execute(interaction, bot) {
    await answerReplay(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
