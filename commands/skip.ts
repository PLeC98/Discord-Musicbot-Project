import { SlashCommandBuilder } from "discord.js";
import { answerSkip } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  help: { section: "play", tier: "dj-or-requester" },
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track").setDescriptionLocalizations({ ko: "현재 재생 중인 곡을 건너뛰어요" }),

  async execute(interaction, client) {
    await answerSkip(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
