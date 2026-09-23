const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const config = require("../config");
// 이름표와 이모지는 임베드와 같은 표에서 나온다
const { labelOf, emojiOf } = require("../src/ui/platforms");

module.exports = {
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

      if (track.duration && track.duration > 0) {
        const progressBar = this.createProgressBar(currentTime, track.duration * 1000);
        const currentTimeFormatted = this.formatTime(currentTime);
        const totalTimeFormatted = this.formatDuration(track.duration);

        embed.addFields({
          name: "⏱️ 진행",
          value: `${currentTimeFormatted} / ${totalTimeFormatted}\n${progressBar}`,
          inline: false,
        });
      }

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

  formatDuration(seconds) {
    return require("../src/ui/format").formatDuration(seconds); // 공용 구현: src/ui/format.js
  },

  formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return this.formatDuration(seconds);
  },

  createProgressBar(current, total, length = 15) {
    if (!total || total === 0) return "▬".repeat(length);

    const currentMs = typeof current === "number" ? current : 0;
    const totalMs = total;
    const progress = Math.min(currentMs / totalMs, 1);
    const filledLength = Math.round(progress * length);

    const filled = "▬".repeat(filledLength);
    const empty = "▬".repeat(length - filledLength);
    const indicator = "🔘";

    if (filledLength === 0) {
      return indicator + empty;
    } else if (filledLength === length) {
      return filled + indicator;
    } else {
      return filled + indicator + empty.substring(1);
    }
  },
};
