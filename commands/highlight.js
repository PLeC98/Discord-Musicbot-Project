"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// SponsorBlock poi_highlight(커뮤니티 하이라이트 지점)로 점프. 핵심만 듣고 /skip 하는 용도.
module.exports = {
  data: new SlashCommandBuilder().setName("highlight").setDescription("Jump to the community highlight of the current track").setDescriptionLocalizations({ ko: "현재 곡의 하이라이트 지점으로 이동합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    const permErr = await checkControl(member);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    if (!player.currentTrack) return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: [1 << 6] });

    const highlightAt = player.currentTrack.sponsor?.highlightAt;
    if (highlightAt === null || highlightAt === undefined) {
      return interaction.reply({ content: "❌ 이 곡에는 SponsorBlock 하이라이트 지점이 없어요.", flags: [1 << 6] });
    }

    const seekMs = Math.max(0, Math.floor(highlightAt * 1000));
    await interaction.deferReply({ flags: [1 << 6] });
    await player.play(null, seekMs);

    const embed = new EmbedBuilder()
      .setTitle("✨ 하이라이트로 이동")
      .setDescription(`**[${player.currentTrack.title}](${player.currentTrack.url})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "⏱️ 위치", value: `\`${formatMs(seekMs)}\``, inline: true });

    await interaction.editReply({ embeds: [embed] });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
