"use strict";

const { SlashCommandBuilder } = require("discord.js");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous track").setDescriptionLocalizations({ ko: "이전 곡을 재생합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    const permErr = await checkControl(member);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    if (player.previousTracks.length === 0) return interaction.reply({ content: "❌ 이전 노래가 없습니다!", flags: [1 << 6] });

    const result = player.previous();

    if (!result) return interaction.reply({ content: "❌ 이전 노래로 이동하지 못했습니다!", flags: [1 << 6] });

    await interaction.reply({ content: "⏮️ 이전 노래로 이동했습니다!", flags: [1 << 6] });

    if (client.musicEmbedManager && player.currentTrack) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
