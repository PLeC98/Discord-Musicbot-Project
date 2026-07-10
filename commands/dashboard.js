"use strict";

const { SlashCommandBuilder } = require("discord.js");
const S = require("../src/strings");
const GuildSettingsManager = require("../src/GuildSettingsManager");
const { checkControl } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder().setName("dashboard").setDescription("Repost the now-playing panel at the bottom of this channel").setDescriptionLocalizations({ ko: "현재 재생 중 패널을 채널 하단에 띄웁니다" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    // 패널을 호출 채널로 옮기는 부작용이 있는 명령어 — 봇 전용 채널이 지정된 서버: 그 채널에서만 사용 가능하되 전원 허용 (패널이 항상 전용 채널에 유지됨)
    //  미지정 서버(삭제된 채널 포함): 어디서나 사용 가능하되 DJ 계층 필요
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    if (botChannelId && guild.channels.cache.has(botChannelId)) {
      if (channel.id !== botChannelId) {
        return interaction.reply({ content: `❌ 이 명령어는 <#${botChannelId}> 채널에서만 사용할 수 있습니다!`, flags: [1 << 6] });
      }
    } else {
      const permErr = await checkControl(member);
      if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });
    }

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (!player.currentTrack) return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: [1 << 6] });

    if (player.nowPlayingMessage) {
      try {
        await player.nowPlayingMessage.delete();
      } catch {
        /* 이미 삭제되었거나 권한 없음 */
      }
      player.nowPlayingMessage = null;
      player.nowPlayingWebhook = null;
    }

    client.musicEmbedManager.stopProgressUpdate(guild.id);

    player.textChannel = channel;

    await client.musicEmbedManager.createNewMusicEmbed(player, player.currentTrack, member, interaction);
  },
};
