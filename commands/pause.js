"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause or resume the current track").setDescriptionLocalizations({ ko: "일시정지를 토글합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: 64 });
    if (!player.currentTrack) return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: 64 });

    const permErr = await checkControl(member);
    if (permErr) return interaction.reply({ content: permErr, flags: 64 });

    let result, message, emoji;
    if (player.paused) {
      result = player.resume();
      message = "음악 재개됨";
      emoji = "▶️";
    } else {
      result = player.pause();
      message = "음악 일시정지됨";
      emoji = "⏸️";
    }

    if (!result) return interaction.reply({ content: "❌ 작업이 실패했습니다!", flags: 64 });

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${message}`)
      .setDescription(`**[${player.currentTrack.title}](${player.currentTrack.url})** ${message}!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 작업자", value: `${member}`, inline: true });

    if (player.currentTrack.thumbnail) embed.setThumbnail(player.currentTrack.thumbnail);

    await interaction.reply({ embeds: [embed], flags: 64 });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
