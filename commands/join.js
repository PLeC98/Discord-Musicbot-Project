"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const log = require("../src/logger").child({ category: "commands" });
const MusicPlayer = require("../src/MusicPlayer");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const CacheManager = require("../src/CacheManager");
const S = require("../src/strings");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder().setName("join").setDescription("Join your voice channel").setDescriptionLocalizations({ ko: "봇을 음성 채널에 참가시킵니다" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const permissions = member.voice.channel.permissionsFor(guild.members.me);
    if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) return interaction.reply({ content: S.ERR_NO_PERMISSIONS, flags: [1 << 6] });

    // 이미 채널에 접속해 있음
    const existing = client.players.get(guild.id);
    if (existing?.connection) {
      return interaction.reply({ content: "✅ 이미 채널에 접속해 있어요.", flags: [1 << 6] });
    }

    if (!client.musicEmbedManager) {
      client.musicEmbedManager = new MusicEmbedManager(client);
    }

    // /leave에서 저장한 세션이 있는지 확인
    const savedState = CacheManager.getPlayerSession(guild.id);
    const hasSession = savedState?.currentTrack;

    const player = new MusicPlayer(guild, channel, member.voice.channel);
    client.players.set(guild.id, player);

    if (hasSession) {
      await interaction.deferReply();
      try {
        await player.restoreFromState(savedState);

        if (!player.currentTrack) {
          await interaction.editReply({ content: "✅ 음성 채널에 접속했어요. (세션 복구 실패 - 곡을 찾을 수 없음)" });
          return;
        }

        // restoreFromState가 이미 새 CV2 현재 재생 메시지를 보냈음;
        // defer된 응답은 CV2 메시지로 수정할 수 없으므로 일반 응답으로 유지
        await interaction.editReply({ content: `▶️ 이전 세션을 복구했어요! **${player.currentTrack.title}** 재생 중` });
      } catch (error) {
        log.error({ sub: "join" }, "세션 복원 실패:", error.message);
        player.releaseResources();
        player.disconnect();
        client.players.delete(guild.id);
        await interaction.editReply({ content: "⚠️ 이전 세션 복구 중 오류가 발생했습니다. `/play`로 다시 시작해 주세요." });
      }
    } else {
      await player.connect();
      player.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});
      await interaction.reply({ content: "✅ 음성 채널에 접속했어요!", flags: [1 << 6] });
    }
  },
};
