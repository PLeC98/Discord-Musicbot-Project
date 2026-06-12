"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");

module.exports = {
  data: new SlashCommandBuilder().setName("replay").setDescription("Restart the current track from the beginning").setDescriptionLocalizations({ ko: "현재 곡을 처음부터 재생합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (player.voiceChannel?.id !== member.voice.channel.id) return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });

    if (!member.permissions.has("ManageGuild") && !member.roles.cache.some((r) => r.name.toLowerCase().includes("dj"))) return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

    if (!player.currentTrack) return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: [1 << 6] });

    const track = player.currentTrack;

    await interaction.deferReply({ flags: [1 << 6] });
    await player.play(null, 0);

    const embed = new EmbedBuilder()
      .setTitle("🔄 처음부터 다시 재생")
      .setDescription(`**[${track.title}](${track.url})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 요청한 사람", value: `${member}`, inline: true });

    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    await interaction.editReply({ embeds: [embed] });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
