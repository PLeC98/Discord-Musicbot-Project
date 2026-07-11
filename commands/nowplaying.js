const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const config = require("../config");

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

      const PLATFORM_NAMES = {
        youtube: "YouTube",
        spotify: "Spotify",
        soundcloud: "SoundCloud",
        direct: "직접 링크",
      };
      const platformCode = (track.platform || "unknown").toString().toLowerCase();
      const platformName = PLATFORM_NAMES[platformCode] || (track.platform ? track.platform.charAt(0).toUpperCase() + track.platform.slice(1) : "알 수 없음");

      const embed = new EmbedBuilder().setTitle("🎵 현재 재생 중").setDescription(`**[${track.title}](${track.url})**`).setColor(config.bot.embedColor).setTimestamp();

      if (track.artist) {
        embed.addFields({ name: "🎤 아티스트", value: track.artist, inline: true });
      }

      if (track.album) {
        embed.addFields({ name: "💿 앨범", value: track.album, inline: true });
      }

      embed.addFields({
        name: "🎵 플랫폼",
        value: `${this.getPlatformEmoji(platformCode)} ${platformName}`,
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

      if (status.shuffle) {
        statusText += " • 🔀 셔플";
      }

      embed.addFields({ name: "📊 상태", value: statusText, inline: false });

      if (player.queue.length > 0) {
        embed.addFields({
          name: "🔜 다음 노래",
          value: `[${player.queue[0].title}](${player.queue[0].url})`,
          inline: false,
        });

        embed.setFooter({ text: `대기열에 ${player.queue.length}개의 노래가 더 있습니다` });
      } else {
        embed.setFooter({ text: "대기열에 더 이상 노래가 없습니다" });
      }

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
    return require("../src/utils").formatDuration(seconds); // 공용 구현: src/utils.js
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

  getPlatformEmoji(platform) {
    const emojis = {
      youtube: "🔴",
      spotify: "🟢",
      soundcloud: "🟠",
      direct: "🔗",
    };
    return emojis[platform] || "🎵";
  },
};
