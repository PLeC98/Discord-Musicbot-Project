"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkSkip } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track").setDescriptionLocalizations({ ko: "현재 재생 중인 곡을 건너뜁니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    const permErr = await checkSkip(member, player);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    if (!player.currentTrack) return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: [1 << 6] });

    // 한곡 반복 중에는 스킵 = 현재 곡 재시작이라 대기열이 비어도 유효
    if (player.queue.length === 0 && player.loop !== "track") return interaction.reply({ content: "❌ 건너뛸 노래가 없습니다! 대기열에 노래가 없습니다.", flags: [1 << 6] });

    const currentTrack = player.currentTrack;
    const skipped = player.skip();

    if (!skipped) return interaction.reply({ content: "❌ 노래가 건너뛰어지지 않았습니다!", flags: [1 << 6] });

    if (player.loop === "track") return interaction.reply({ content: `🔂 한곡 반복 중 — **${currentTrack.title}**을(를) 처음부터 다시 재생합니다! (다음 곡으로 가려면 반복을 해제하세요)`, flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("⏭️ 노래 건너뜀")
      .setDescription(`**[${currentTrack.title}](${currentTrack.url})** 건너뜀!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 건너뛴 사람", value: `${member}`, inline: true });

    if (player.queue.length > 0) {
      embed.addFields({ name: "🔜 다음 노래", value: `[${player.queue[0].title}](${player.queue[0].url})`, inline: false });
      embed.setFooter({ text: `대기열에 ${player.queue.length}개의 노래가 더 있습니다` });
    } else {
      embed.setFooter({ text: "대기열에 더 이상 노래가 없습니다" });
    }

    if (currentTrack.thumbnail) embed.setThumbnail(currentTrack.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager && player.currentTrack) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
