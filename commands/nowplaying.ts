import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
// 이름표와 이모지는 임베드와 같은 표에서 나온다
import { labelOf, emojiOf } from "../src/ui/platforms.ts";
import { progressBar } from "../src/ui/progressBar.ts";
import { playbackStatus } from "../src/ui/playerStatus.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { Player } from "../src/player/Player.ts";
import type { QueuedTrack } from "../src/player/track.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as infoText from "../src/ui/text/info.ts";
import * as errors from "../src/ui/text/errors.ts";

// 재생 패널과 같은 막대. 길이를 모르는 곡(라이브 아님)은 뺀다
function progressField(player: Player, track: QueuedTrack, currentMs: number) {
  const live = Boolean(player.isLive ?? track.isLive);
  if (!live && !(track.duration > 0)) return null;
  return { name: infoText.nowPlaying().progress, value: progressBar(Math.floor(currentMs / 1000), track.duration || 0, { live }), inline: false };
}

function createErrorEmbed(message: string) {
  return new EmbedBuilder().setTitle(infoText.errorTitle()).setDescription(message).setColor(colorOf("error")).setTimestamp();
}

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Shows information about currently playing song").setDescriptionLocalizations({
    ko: "현재 재생 중인 곡의 정보를 보여줍니다",
  }),

  async execute(interaction, client) {
    const guild = interaction.guild;

    const player = client.players.get(guild.id);
    if (!player) {
      return await interaction.reply({
        embeds: [createErrorEmbed(errors.withoutErrorMark(errors.noPlayer()))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!player.currentTrack) {
      return await interaction.reply({
        embeds: [createErrorEmbed(errors.withoutErrorMark(errors.noTrack()))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const track = player.currentTrack;
    const currentTime = player.getCurrentTime();
    const status = playbackStatus(player);

    const platformCode = (track.platform || "").toString().toLowerCase();

    const t = infoText.nowPlaying();
    const embed = new EmbedBuilder().setTitle(t.title).setDescription(`**[${track.title}](${track.pageUrl})**`).setColor(colorOf("brand")).setTimestamp();

    if (track.artist) {
      embed.addFields({ name: t.artist, value: track.artist, inline: true });
    }

    if (track.album) {
      embed.addFields({ name: t.album, value: track.album, inline: true });
    }

    embed.addFields({
      name: t.platform,
      value: `${emojiOf(platformCode)} ${labelOf(platformCode)}`,
      inline: true,
    });

    const progress = progressField(player, track, currentTime);
    if (progress) embed.addFields(progress);

    if (track.requestedBy) {
      embed.addFields({
        name: t.requester,
        value: `<@${track.requestedBy.id}>`,
        inline: true,
      });
    }

    embed.addFields({ name: t.status, value: infoText.nowPlayingStatus(status), inline: false });

    // 썸네일 추가
    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    await interaction.reply({
      embeds: [embed],
    });
  },
};
export default exported;
export { createErrorEmbed };
