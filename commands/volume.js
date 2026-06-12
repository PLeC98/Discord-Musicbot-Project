"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume")
    .setDescriptionLocalizations({ ko: "재생 볼륨을 설정합니다" })
    .addIntegerOption((option) => option.setName("level").setDescription("Volume level (0–100)").setDescriptionLocalizations({ ko: "볼륨 크기 (0–100)" }).setRequired(true).setMinValue(0).setMaxValue(100)),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (player.voiceChannel?.id !== member.voice.channel.id) return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });

    if (!member.permissions.has("ManageGuild") && !member.roles.cache.some((r) => r.name.toLowerCase().includes("dj"))) return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

    const level = interaction.options.getInteger("level");
    const previousVolume = player.volume;
    player.setVolume(level);

    const volumeBar = "█".repeat(Math.round(level / 10)) + "░".repeat(10 - Math.round(level / 10));

    const embed = new EmbedBuilder()
      .setTitle("🔊 볼륨이 변경되었습니다")
      .setDescription(`볼륨이 **${level}%**로 설정되었습니다!\n\`[${volumeBar}] ${level}%\``)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "이전", value: `${previousVolume}%`, inline: true }, { name: "현재", value: `${level}%`, inline: true }, { name: "👤 변경한 사람", value: `${member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
