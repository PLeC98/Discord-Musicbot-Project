import { SlashCommandBuilder } from "discord.js";
import { answerHighlight } from "../interactions/controlAnswers.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

// SponsorBlock poi_highlight(커뮤니티 하이라이트 지점)로 점프. 핵심만 듣고 /skip 하는 용도.
const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("highlight").setDescription("Jump to the community highlight of the current track").setDescriptionLocalizations({ ko: "현재 곡의 하이라이트 지점으로 이동합니다" }),

  async execute(interaction, client) {
    await answerHighlight(interaction, client.players.get(interaction.guild.id));
  },
};
export default exported;
