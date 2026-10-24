import { SlashCommandBuilder } from "discord.js";
import type { GuildCommand } from "../../app/command-loader.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { reply } from "../../ui/frame.ts";
import { nowPlayingView } from "../../ui/now-playing-info.ts";
import * as discordArt from "../../ui/discord-art.ts";
import { LIFETIME, noticeSelf, toSelf } from "../../ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "explore", tier: "everyone" },
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Shows information about currently playing song").setDescriptionLocalizations({
    ko: "재생 중인 곡의 정보를 보여줘요",
  }),

  async execute(interaction, bot) {
    const player = bot.players.get(interaction.guild.id);
    if (!player) return await noticeSelf(interaction, errors.notice("no-song"));
    if (!player.currentTrack) return await noticeSelf(interaction, errors.notice("no-song"));
    // 직접 링크 곡은 파일 태그 그림을 첨부한다(ui/discord-art)
    const art = await discordArt.artFor(player.currentTrack);
    await toSelf(interaction, reply(nowPlayingView(player, player.currentTrack, art), art?.file && [art.file]), LIFETIME.screen);
  },
};
export default exported;
