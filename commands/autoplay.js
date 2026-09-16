"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");
const { buildGenreMenu } = require("../src/genreMenu");
const { keepReply } = require("../src/replyLifetime");

// 장르는 옵션으로 받지 않는다 — 자동재생 버튼과 같은 선택 화면을 띄운다.
// 옵션으로 받으면 목록이 기동 시점에 굳고(choices), 명령 정의가 config/genres.js의 label 대신
// 영문 키를 쓰게 되어 두 진입점이 다른 것을 보여준다.

module.exports = {
  data: new SlashCommandBuilder().setName("autoplay").setDescription("Toggle autoplay. Pick a genre when turning it on.").setDescriptionLocalizations({ ko: "자동재생을 토글합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;

    const player = client.players.get(guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    const permErr = await checkControl(member);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    if (player.autoplay) {
      player.setAutoplay(false);

      const embed = new EmbedBuilder().setTitle("🎲 자동 재생이 비활성화되었습니다").setDescription("자동 재생 기능이 꺼졌습니다.").setColor(config.bot.embedColor).setTimestamp();

      await interaction.reply({ embeds: [embed], flags: [1 << 6] });

      if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
      return;
    }

    // 고르는 동안 떠 있어야 한다 — 고른 뒤에는 선택 핸들러가 결과로 덮는다
    keepReply(interaction);
    await interaction.reply(buildGenreMenu(member.id, player.sessionId));
  },
};
