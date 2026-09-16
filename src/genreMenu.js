"use strict";

// 자동재생 장르 선택 화면 — 자동재생 버튼과 `/autoplay`가 같은 것을 띄운다.
// 진입점마다 따로 만들면 한쪽만 고쳐져 갈라진다(실제로 명령 쪽은 영문 키 목록을 쓰고 있었다).

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require("discord.js");
const config = require("../config");

// 끄고 나서 장르를 다시 고를 수 있는 시간. "더 넣기" 메뉴와 같은 값으로 맞춘다.
const OFF_MENU_MS = 30_000;

/**
 * 본인에게만 보이는 장르 선택 메시지. 그대로 reply에 넘긴다.
 * 고른 결과는 events/modalHandler.js의 autoplay_genre 처리가 받는다.
 */
function genreSelect(requesterId, sessionId, placeholder) {
  // 장르 정의는 config/genres.js 한 곳에서 관리 — 부를 때마다 읽는다(편집 반영 대비)
  const genres = require("../config/genres");

  return new StringSelectMenuBuilder()
    .setCustomId(`autoplay_genre:${requesterId}:${sessionId}`)
    .setPlaceholder(placeholder)
    .addOptions(Object.entries(genres).map(([value, g]) => new StringSelectMenuOptionBuilder().setLabel(g.label).setValue(value).setEmoji(g.emoji)));
}

/** 켤 때 — 장르를 고르면 그 장르로 켜진다. 고르는 동안 떠 있어야 한다(keepReply). */
function buildGenreMenu(requesterId, sessionId) {
  const embed = new EmbedBuilder().setTitle("🎲 음악 장르 선택").setDescription("대기열이 끝나면 어떤 장르를 재생할까요?").setColor(config.bot.embedColor);

  const select = genreSelect(requesterId, sessionId, "음악 장르를 선택하세요...");
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], flags: [1 << 6] };
}

/**
 * 끌 때 — 이미 꺼진 상태를 알리면서, 30초 동안 장르를 다시 고를 기회를 준다.
 * 고르면 그 장르로 다시 켜지고(장르 변경), 그냥 두거나 닫으면 꺼진 채로 끝난다.
 */
function buildAutoplayOffMenu(requesterId, sessionId) {
  const embed = new EmbedBuilder().setTitle("🎲 자동 재생이 비활성화되었습니다").setDescription("다른 장르로 다시 켜려면 아래에서 고르세요. 그냥 두면 꺼진 채로 둡니다.").setColor(config.bot.embedColor).setTimestamp();

  const select = genreSelect(requesterId, sessionId, "장르를 바꿔 다시 켜기...");
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)], flags: [1 << 6] };
}

module.exports = { buildGenreMenu, buildAutoplayOffMenu, OFF_MENU_MS };
