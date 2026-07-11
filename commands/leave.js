"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel and save the current queue for later").setDescriptionLocalizations({ ko: "음성 채널에서 나가고 현재 대기열을 저장합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    // 재적 규칙 + DJ 계층 (관리자는 어디서든) — 두 분기 공통이므로 선두에서 한 번만
    const permErr = await checkControl(member);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    const player = client.players.get(guild.id);

    // 플레이어는 없지만 봇은 아직 음성 채널에 있음 (음악 종료 후 자동 퇴장 타이머가 아직 실행되지 않음)
    if (!player) {
      if (!guild.members.me?.voice?.channel) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

      await guild.members.me.voice.disconnect();
      return interaction.reply({
        content: "👋 음성 채널에서 나갔습니다!",
        flags: [1 << 6],
      });
    }

    const currentTrack = player.currentTrack;
    const queueLength = player.queue.length;
    const positionSec = Math.floor((player.getCurrentTime?.() || 0) / 1000);

    // 상태를 저장하고 연결 해제 (/join 복구용 세션은 DB에 보존)
    await player.leaveAndSave();
    client.players.delete(guild.id);

    if (client.musicEmbedManager) await client.musicEmbedManager.handlePlaybackEnd(player);

    const embed = new EmbedBuilder()
      .setTitle("👋 채널에서 나갔습니다")
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 실행한 사람", value: `${member}`, inline: true });

    if (currentTrack) {
      const m = Math.floor(positionSec / 60);
      const s = String(positionSec % 60).padStart(2, "0");
      embed.setDescription(`**[${currentTrack.title}](${currentTrack.url})**`).addFields({ name: "⏱️ 저장된 위치", value: `\`${m}:${s}\``, inline: true }, { name: "📋 저장된 대기열", value: `${queueLength}곡`, inline: true });
    }

    embed.setFooter({ text: "/join 으로 이전 세션을 복구할 수 있습니다." });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
