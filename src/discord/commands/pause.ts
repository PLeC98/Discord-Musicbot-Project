import { SlashCommandBuilder } from "discord.js";
import { answerPause } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause or resume the current track").setDescriptionLocalizations({ ko: "일시정지 상태를 전환해요" }),

  async execute(interaction, bot) {
    await answerPause(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
