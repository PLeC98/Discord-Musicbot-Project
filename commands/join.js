"use strict";

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const MusicPlayer = require("../src/MusicPlayer");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const CacheManager = require("../src/CacheManager");
const S = require("../src/strings");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel (restores previous session if available)").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시킵니다 (이전 세션이 있으면 복구)" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const permissions = member.voice.channel.permissionsFor(guild.members.me);
    if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return interaction.reply({ content: S.ERR_NO_PERMISSIONS, flags: [1 << 6] });

    // Already in channel
    const existing = client.players.get(guild.id);
    if (existing?.connection) {
      return interaction.reply({ content: "✅ 이미 채널에 접속해 있어요.", flags: [1 << 6] });
    }

    if (!client.musicEmbedManager) {
      client.musicEmbedManager = new MusicEmbedManager(client);
    }

    // Check for a saved session (set by /leave)
    const savedState = CacheManager.getPlayerSession(guild.id);
    const hasSession = savedState?.currentTrack;

    const player = new MusicPlayer(guild, channel, member.voice.channel);
    client.players.set(guild.id, player);

    if (hasSession) {
      await interaction.deferReply();
      try {
        await player.restoreFromState(savedState);

        if (!player.currentTrack) {
          await interaction.editReply({ content: "✅ 음성 채널에 접속했습니다. (세션 복구 실패 - 곡을 찾을 수 없음)" });
          return;
        }

        // restoreFromState already sent a fresh CV2 now-playing message;
        // a deferred reply cannot be edited into a CV2 message, so keep this plain
        await interaction.editReply({ content: `▶️ 이전 세션을 복구했어요! **${player.currentTrack.title}** 재생 중` });
      } catch (error) {
        console.error("[join] Session restore failed:", error.message);
        player.releaseResources();
        player.disconnect();
        client.players.delete(guild.id);
        await interaction.editReply({ content: "⚠️ 이전 세션 복구 중 오류가 발생했습니다. `/play`로 다시 시작해 주세요." });
      }
    } else {
      await player.connect();
      player.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});
      await interaction.reply({ content: "✅ 음성 채널에 접속했습니다!", flags: [1 << 6] });
    }
  },
};
