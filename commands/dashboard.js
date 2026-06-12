"use strict";

const { SlashCommandBuilder } = require("discord.js");
const S = require("../src/strings");

module.exports = {
  data: new SlashCommandBuilder().setName("dashboard").setDescription("Repost the now-playing panel at the bottom of this channel").setDescriptionLocalizations({ ko: "현재 재생 중 패널을 채널 하단에 띄웁니다" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (!player.currentTrack) return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: [1 << 6] });

    if (player.nowPlayingMessage) {
      try {
        await player.nowPlayingMessage.delete();
      } catch {
        /* already deleted or no permission */
      }
      player.nowPlayingMessage = null;
      player.nowPlayingWebhook = null;
    }

    client.musicEmbedManager.stopProgressUpdate(guild.id);

    player.textChannel = channel;

    await client.musicEmbedManager.createNewMusicEmbed(player, player.currentTrack, member, interaction);
  },
};
