"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkRemoveTrack } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a specific track from the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 특정 곡을 제거합니다" })
    .addIntegerOption((option) => option.setName("position").setDescription("Position in queue (e.g. 1 = next song)").setDescriptionLocalizations({ ko: "대기열 순서 (예: 1 = 다음 곡)" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (player.queue.length === 0) return interaction.reply({ content: S.ERR_NO_SONGS_IN_QUEUE, flags: [1 << 6] });

    const position = interaction.options.getInteger("position");

    if (position > player.queue.length) return interaction.reply({ content: `❌ 대기열에 ${player.queue.length}개의 곡만 있습니다. (1–${player.queue.length} 범위로 입력하세요)`, flags: [1 << 6] });

    // DJ 계층이 아니어도 자기가 추가한 곡은 제거 가능
    const permErr = await checkRemoveTrack(member, player.queue[position - 1]);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    const removed = player.removeFromQueue(position - 1);

    const embed = new EmbedBuilder()
      .setTitle("🗑️ 곡 제거됨")
      .setDescription(`**[${removed.title}](${removed.url})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 제거한 사람", value: `${member}`, inline: true }, { name: "📋 남은 대기열", value: `${player.queue.length}곡`, inline: true });

    if (removed.thumbnail) embed.setThumbnail(removed.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
