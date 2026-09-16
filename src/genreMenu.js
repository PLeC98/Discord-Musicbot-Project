"use strict";

// 자동재생 장르 선택 화면 — 자동재생 버튼과 `/autoplay`가 같은 것을 띄운다.
// 진입점마다 따로 만들면 한쪽만 고쳐져 갈라진다(실제로 명령 쪽은 영문 키 목록을 쓰고 있었다).

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require("discord.js");
const config = require("../config");

/**
 * 본인에게만 보이는 장르 선택 메시지. 그대로 reply에 넘긴다.
 * 고른 결과는 events/modalHandler.js의 autoplay_genre 처리가 받는다.
 */
function buildGenreMenu(requesterId, sessionId) {
  // 장르 정의는 config/genres.js 한 곳에서 관리 — 부를 때마다 읽는다(편집 반영 대비)
  const genres = require("../config/genres");

  const select = new StringSelectMenuBuilder()
    .setCustomId(`autoplay_genre:${requesterId}:${sessionId}`)
    .setPlaceholder("음악 장르를 선택하세요...")
    .addOptions(Object.entries(genres).map(([value, g]) => new StringSelectMenuOptionBuilder().setLabel(g.label).setValue(value).setEmoji(g.emoji)));

  const embed = new EmbedBuilder().setTitle("🎲 음악 장르 선택").setDescription("대기열이 끝나면 어떤 장르를 재생할까요?").setColor(config.bot.embedColor);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], flags: [1 << 6] };
}

module.exports = { buildGenreMenu };
