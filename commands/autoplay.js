"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");

const GENRES = ["pop", "rock", "hiphop", "electronic", "jazz", "classical", "metal", "country", "rnb", "indie", "kpop", "anime", "lofi", "blues", "disco", "punk", "ambient", "random"];

const GENRE_LABELS = {
  pop: "팝",
  rock: "록",
  hiphop: "힙합",
  electronic: "일렉트로닉",
  jazz: "재즈",
  classical: "클래식",
  metal: "메탈",
  country: "컨트리",
  rnb: "R&B",
  indie: "인디",
  kpop: "K-POP",
  anime: "애니",
  lofi: "로파이",
  blues: "블루스",
  disco: "디스코",
  punk: "펑크",
  ambient: "앰비언트",
  random: "랜덤",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Enable or disable autoplay. If already on, turns it off.")
    .setDescriptionLocalizations({ ko: "자동재생을 토글합니다" })
    .addStringOption((option) =>
      option
        .setName("genre")
        .setDescription("Genre for autoplay recommendations (omit to toggle off if active)")
        .setDescriptionLocalizations({ ko: "자동재생 장르 (생략 시 토글, 꺼져 있으면 장르가 필요합니다)" })
        .setRequired(false)
        .addChoices(...GENRES.map((g) => ({ name: g.charAt(0).toUpperCase() + g.slice(1), value: g }))),
    ),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    if (!member.voice.channel) return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    if (player.voiceChannel?.id !== member.voice.channel.id) return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });

    if (!member.permissions.has("ManageGuild") && !member.roles.cache.some((r) => r.name.toLowerCase().includes("dj"))) return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

    const genre = interaction.options.getString("genre");

    if (player.autoplay && !genre) {
      player.autoplay = false;

      const embed = new EmbedBuilder().setTitle("🎲 자동 재생이 비활성화되었습니다").setDescription("자동 재생 기능이 꺼졌습니다.").setColor(config.bot.embedColor).setTimestamp();

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

      if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
      return;
    }

    if (!genre) {
      const genreList = GENRES.map((g) => `\`${g}\``).join(", ");
      return interaction.reply({
        content: `자동재생이 꺼져 있습니다. \`/autoplay genre:<장르>\`로 활성화하세요.\n사용 가능한 장르: ${genreList}`,
        flags: [1 << 6],
      });
    }

    player.autoplay = genre;
    const genreName = GENRE_LABELS[genre] || genre;

    const embed = new EmbedBuilder()
      .setTitle("🎲 자동 재생이 활성화되었습니다")
      .setDescription(`**${genreName}** 장르로 자동 재생이 설정되었습니다. 대기열이 끝나면 자동으로 재생됩니다.`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 변경한 사람", value: `${member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });

    if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
  },
};
