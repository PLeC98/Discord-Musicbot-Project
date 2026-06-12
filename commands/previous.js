"use strict";

const { SlashCommandBuilder } = require("discord.js");
const S = require("../src/strings");

module.exports = {
  data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous track").setDescriptionLocalizations({ ko: "이전 곡을 재생합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (player.voiceChannel?.id !== member.voice.channel.id) return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });

    if (!member.permissions.has("ManageGuild") && !member.roles.cache.some((r) => r.name.toLowerCase().includes("dj"))) return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

    if (player.previousTracks.length === 0) return interaction.reply({ content: "❌ 이전 노래가 없습니다!", flags: [1 << 6] });

    const result = player.previous();

    if (!result) return interaction.reply({ content: "❌ 이전 노래로 이동하지 못했습니다!", flags: [1 << 6] });

    await interaction.reply({ content: "⏮️ 이전 노래로 이동했습니다!", flags: [1 << 6] });

    if (client.musicEmbedManager && player.currentTrack) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
