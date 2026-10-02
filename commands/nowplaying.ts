import { SlashCommandBuilder } from "discord.js";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply, post } from "../src/ui/frame.ts";
import { nowPlayingView } from "../src/ui/nowPlayingInfo.ts";

const exported: GuildCommand = {
  help: { section: "explore", tier: "everyone" },
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Shows information about currently playing song").setDescriptionLocalizations({
    ko: "재생 중인 곡의 정보를 보여줘요",
  }),

  async execute(interaction, client) {
    const player = client.players.get(interaction.guild.id);
    if (!player) return await interaction.reply(noticeReply(errors.notice("no-song")));
    if (!player.currentTrack) return await interaction.reply(noticeReply(errors.notice("no-song")));
    await interaction.reply(post(nowPlayingView(player, player.currentTrack)));
  },
};
export default exported;
