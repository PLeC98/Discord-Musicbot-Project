"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");

module.exports = {
  data: new SlashCommandBuilder().setName("clear").setDescription("Clear the queue").setDescriptionLocalizations({ ko: "대기열을 비웁니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (player.voiceChannel?.id !== member.voice.channel.id) return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });

    if (!member.permissions.has("ManageGuild") && !member.roles.cache.some((r) => r.name.toLowerCase().includes("dj"))) return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

    const count = player.queue.length;
    if (count === 0) return interaction.reply({ content: S.ERR_NO_SONGS_IN_QUEUE, flags: [1 << 6] });

    player.queue = [];

    const embed = new EmbedBuilder()
      .setTitle("🗑️ 대기열 비워짐")
      .setDescription(`대기열에서 ${count}개의 노래가 제거되었습니다`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 변경한 사람", value: `${member}`, inline: true });

    if (player.currentTrack) {
      embed.addFields({
        name: "🎵 현재 재생 중",
        value: `**[${player.currentTrack.title}](${player.currentTrack.url})**`,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
