"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback and disconnect from voice channel").setDescriptionLocalizations({ ko: "재생을 정지하고 음성 채널에서 퇴장합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    const permErr = await checkControl(member);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    const queueLength = player.queue.length;
    const currentTrack = player.currentTrack;

    player.stop();
    client.players.delete(guild.id);

    const embed = new EmbedBuilder()
      .setTitle("⏹️ 음악 중지됨")
      .setDescription(`${currentTrack ? `**[${currentTrack.title}](${currentTrack.url})**` : "Music"} 중지됨!`)
      .setColor("#FF0000")
      .setTimestamp()
      .addFields({ name: "👤 중지한 사람", value: `${member}`, inline: true });

    if (queueLength > 0) embed.setFooter({ text: `대기열에서 ${queueLength}개의 노래가 제거되었습니다` });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager) await client.musicEmbedManager.handlePlaybackEnd(player);
  },
};
