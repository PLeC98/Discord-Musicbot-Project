"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { checkControl, checkSummon } = require("../src/permissions");
const { ensurePlayer } = require("../src/playRequest");
const { buildGenreMenu, buildAutoplayOffMenu, OFF_MENU_MS } = require("../src/genreMenu");
const { keepReply, expireReply } = require("../src/replyLifetime");

// 장르는 옵션으로 받지 않는다. 자동재생 버튼과 같은 선택 화면을 띄운다.
// 옵션으로 받으면 목록이 기동 시점에 굳어(choices) 장르를 고쳐도 재배포 전까지 반영되지 않는다.

module.exports = {
  data: new SlashCommandBuilder().setName("autoplay").setDescription("Toggle autoplay. Pick a genre when turning it on.").setDescriptionLocalizations({ ko: "자동재생을 토글합니다" }),

  async execute(interaction, client) {
    const { guild, member, channel } = interaction;

    // 재생 조작이므로 DJ 계층. 봇이 유휴면 재적 검사가 통과해 버리므로 소환 가능 여부를 이어 붙인다.
    const permErr = (await checkControl(member)) || checkSummon(member);
    if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

    // 틀고 있지 않아도 켤 수 있다. 장르를 고르면 그 자리에서 첫 곡을 뽑아 재생한다.
    const player = client.players.get(guild.id) ?? ensurePlayer(client, { guild, textChannel: channel, voiceChannel: member.voice?.channel ?? null });

    if (player.autoplay) {
      player.setAutoplay(false);

      // 끄기는 이미 실행됐다. 30초 동안 장르를 다시 고를 기회만 남긴다. 고르면 변경, 두면 종료.
      expireReply(interaction, OFF_MENU_MS);
      await interaction.reply(buildAutoplayOffMenu(member.id, player.sessionId));

      if (client.musicEmbedManager) await client.musicEmbedManager.updateNowPlayingEmbed(player);
      return;
    }

    // 고르는 동안 떠 있어야 한다. 고른 뒤에는 선택 핸들러가 결과로 덮는다
    keepReply(interaction);
    await interaction.reply(buildGenreMenu(member.id, player.sessionId));
  },
};
