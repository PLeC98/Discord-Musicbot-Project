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

    // 한곡 반복 중에는 이전곡 = 현재 곡 재시작이라 기록이 없어도 유효
    if (player.previousTracks.length === 0 && player.loop !== "track") return interaction.reply({ content: "❌ 이전 노래가 없습니다!", flags: [1 << 6] });

    const result = player.previous();

    if (!result) return interaction.reply({ content: "❌ 이전 노래로 이동하지 못했습니다!", flags: [1 << 6] });

    await interaction.reply({ content: player.loop === "track" ? "🔂 한곡 반복 중 — 현재 곡을 처음부터 다시 재생합니다!" : "⏮️ 이전 노래로 이동했습니다!", flags: [1 << 6] });

    if (client.musicEmbedManager && player.currentTrack) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
