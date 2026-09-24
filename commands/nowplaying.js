import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import config from "../config.ts";
// 이름표와 이모지는 임베드와 같은 표에서 나온다
import platforms from "../src/ui/platforms.ts";
const { labelOf, emojiOf } = platforms;
import progressBarModule from "../src/ui/progressBar.ts";
const { progressBar } = progressBarModule;

// 재생 패널과 같은 막대. 길이를 모르는 곡(라이브 아님)은 뺀다
function progressField(player, track, currentMs) {
  const live = Boolean(player.isLive ?? track.isLive);
  if (!live && !(track.duration > 0)) return null;
  return { name: "⏱️ 진행", value: progressBar(Math.floor(currentMs / 1000), track.duration || 0, { live }), inline: false };
}

const exported = {
  data: new SlashCommandBuilder().setName("nowplaying").setDescription("Shows information about currently playing song").setDescriptionLocalizations({
    ko: "현재 재생 중인 곡의 정보를 보여줍니다",
  }),

  async execute(interaction, client) {
    try {
      const guild = interaction.guild;

      const player = client.players.get(guild.id);
      if (!player) {
        return await interaction.reply({
          embeds: [this.createErrorEmbed("현재 재생 중인 음악이 없습니다!")],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!player.currentTrack) {
        return await interaction.reply({
          embeds: [this.createErrorEmbed("현재 재생 중인 노래가 없습니다!")],
          flags: MessageFlags.Ephemeral,
        });
      }

      const track = player.currentTrack;
      const currentTime = player.getCurrentTime();
      const status = player.getStatus();

      const platformCode = (track.platform || "").toString().toLowerCase();

      const embed = new EmbedBuilder().setTitle("🎵 현재 재생 중").setDescription(`**[${track.title}](${track.pageUrl})**`).setColor(config.bot.embedColor).setTimestamp();

      if (track.artist) {
        embed.addFields({ name: "🎤 아티스트", value: track.artist, inline: true });
      }

      if (track.album) {
        embed.addFields({ name: "💿 앨범", value: track.album, inline: true });
      }

      embed.addFields({
        name: "🎵 플랫폼",
        value: `${emojiOf(platformCode)} ${labelOf(platformCode)}`,
        inline: true,
      });

      const progress = progressField(player, track, currentTime);
      if (progress) embed.addFields(progress);

      if (track.requestedBy) {
        embed.addFields({
          name: "👤 요청자",
          value: `<@${track.requestedBy.id}>`,
          inline: true,
        });
      }

      let statusText = "";
      if (status.playing) {
        statusText += "▶️ 재생 중";
      } else if (status.paused) {
        statusText += "⏸️ 일시정지";
      } else {
        statusText += "⏹️ 중지됨";
      }

      statusText += ` • 🔊 ${status.volume}%`;

      if (status.loop === "track") {
        statusText += " • 🔂 트랙 반복";
      } else if (status.loop === "queue") {
        statusText += " • 🔁 대기열 반복";
      }

      embed.addFields({ name: "📊 상태", value: statusText, inline: false });

      // 썸네일 추가
      if (track.thumbnail) {
        embed.setThumbnail(track.thumbnail);
      }

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      await interaction.reply({
        embeds: [this.createErrorEmbed("현재 재생 중인 정보를 가져오는 중 오류가 발생했습니다!")],
        flags: MessageFlags.Ephemeral,
      });
    }
  },

  createErrorEmbed(message) {
    return new EmbedBuilder().setTitle("❌ 오류").setDescription(message).setColor("#FF0000").setTimestamp();
  },
};
export default exported;
export { exported as "module.exports" };
