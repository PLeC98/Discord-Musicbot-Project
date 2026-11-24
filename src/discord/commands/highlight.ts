import { SlashCommandBuilder } from "discord.js";
import { answerHighlight } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import config from "../../config/index.ts";

// SponsorBlock poi_highlight(커뮤니티 하이라이트 지점)로 점프. 핵심만 듣고 /skip 하는 용도.
const exported: GuildCommand = {
  help: { section: "play", tier: "dj" },
  // 하이라이트는 SponsorBlock이 준다. 봇 전체에서 껐으면 등록하지 않는다
  enabled: () => config.sponsorblock.enabled,
  name: "highlight",
  data: (C) => new SlashCommandBuilder().setName("highlight").setDescription(C.highlight.description),

  async execute(interaction, bot) {
    await answerHighlight(interaction, bot.players.get(interaction.guild.id));
  },
};
export default exported;
