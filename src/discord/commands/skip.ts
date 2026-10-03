import { SlashCommandBuilder } from "discord.js";
import { answerSkip } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj-or-requester" },
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track").setDescriptionLocalizations({ ko: "현재 재생 중인 곡을 건너뛰어요" }),

  async execute(interaction, bot) {
    await answerSkip(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
