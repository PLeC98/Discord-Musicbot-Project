"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the play queue")
    .setDescriptionLocalizations({ ko: "대기열을 표시합니다" })
    .addIntegerOption((option) => option.setName("page").setDescription("Page number (default: 1)").setDescriptionLocalizations({ ko: "페이지 번호 (기본값: 1)" }).setRequired(false).setMinValue(1)),

  async execute(interaction, client) {
    const { guild } = interaction;

    const player = client.players.get(guild.id);
    if (!player) {
      return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });
    }

    const queueInfo = player.getQueue();

    if (!queueInfo.current && queueInfo.queue.length === 0) {
      return interaction.reply({ content: S.ERR_NO_SONGS_IN_QUEUE, flags: [1 << 6] });
    }

    const totalQueueTracks = queueInfo.queue.length;
    const totalPages = Math.max(1, Math.ceil(totalQueueTracks / PAGE_SIZE));
    const page = Math.min(interaction.options.getInteger("page") ?? 1, totalPages);
    const offset = (page - 1) * PAGE_SIZE;

    const embed = new EmbedBuilder().setTitle("📝 재생 대기열").setColor(config.bot.embedColor).setTimestamp();

    if (queueInfo.current && page === 1) {
      const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
      const progress = createProgressBar(currentTime, queueInfo.current.duration);
      embed.addFields({
        name: "🎵 현재 재생 중",
        value: `**[${queueInfo.current.title}](${queueInfo.current.url})**\n${progress}`,
        inline: false,
      });
    }

    if (totalQueueTracks > 0) {
      const tracks = queueInfo.queue.slice(offset, offset + PAGE_SIZE);
      let queueText = "";
      tracks.forEach((track, i) => {
        queueText += `\`${offset + i + 1}.\` **[${track.title}](${track.url})**\n`;
      });

      embed.addFields({
        name: `📋 다음 노래들 (${totalQueueTracks}개)`,
        value: queueText,
        inline: false,
      });
    }

    embed.setFooter({
      text: `총 ${totalQueueTracks + (queueInfo.current ? 1 : 0)}개의 노래${totalPages > 1 ? ` • ${page}/${totalPages} 페이지` : ""}`,
    });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};

function createProgressBar(currentMs, totalSeconds) {
  if (!totalSeconds || totalSeconds === 0) return "0:00 / 0:00";
  const current = Math.floor(currentMs / 1000);
  const total = Math.floor(totalSeconds);
  const progress = Math.floor((current / total) * 20);
  const fmt = (s) => {
    const m = Math.floor(s / 60),
      sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  return `${fmt(current)} [${"▓".repeat(progress)}${"░".repeat(20 - progress)}] ${fmt(total)}`;
}
