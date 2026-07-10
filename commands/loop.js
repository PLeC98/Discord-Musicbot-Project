"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode")
    .setDescriptionLocalizations({ ko: "반복 모드를 설정합니다" })
    .addStringOption((option) => option.setName("mode").setDescription("Loop mode (omit to cycle: off → track → queue → off)").setDescriptionLocalizations({ ko: "반복 모드 (생략하면 off → track → queue 순으로 순환)" }).setRequired(false).addChoices({ name: "Off", value: "off" }, { name: "Track (repeat current)", value: "track" }, { name: "Queue (repeat all)", value: "queue" })),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    const permErr = await checkControl(member);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    if (!player.currentTrack) return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: [1 << 6] });

    const modeOption = interaction.options.getString("mode");
    let newLoopMode, modeMessage, modeEmoji;

    if (modeOption) {
      newLoopMode = modeOption === "off" ? false : modeOption;
    } else {
      if (player.loop === false || player.loop === "off") newLoopMode = "track";
      else if (player.loop === "track") newLoopMode = "queue";
      else newLoopMode = false;
    }

    if (newLoopMode === "track") {
      modeMessage = "반복 모드가 **트랙 반복**으로 설정되었습니다. 현재 곡이 계속 재생됩니다.";
      modeEmoji = "🔂";
    } else if (newLoopMode === "queue") {
      modeMessage = "반복 모드가 **대기열 반복**으로 설정되었습니다. 대기열이 끝나면 다시 시작됩니다.";
      modeEmoji = "🔁";
    } else {
      modeMessage = "반복 모드가 이제 **꺼졌습니다**";
      modeEmoji = "➡️";
    }

    player.loop = newLoopMode;

    const embed = new EmbedBuilder()
      .setTitle(`${modeEmoji} 🔁 반복 모드 변경됨`)
      .setDescription(modeMessage)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 변경한 사람", value: `${member}`, inline: true });

    if (player.currentTrack?.thumbnail) embed.setThumbnail(player.currentTrack.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
