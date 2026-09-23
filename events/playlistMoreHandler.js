"use strict";

// 재생목록 "더 넣기" 메뉴(셀렉트)와 직접 입력(모달). 상태는 custom_id에 있다(src/playlistMore.js).

const { Events, MessageFlags } = require("discord.js");
const log = require("../src/infra/log/logger").child({ category: "events" });
const S = require("../src/ui/strings");
const { checkAdd } = require("../src/permissions");
const GuildSettingsManager = require("../src/store/guildSettings");
const { continueCollection } = require("../src/playRequest");
const More = require("../src/playlistMore");

const PROGRESS_EVERY_MS = 2000;

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const isSelect = interaction.isStringSelectMenu() && interaction.customId.startsWith(`${More.SELECT_PREFIX}:`);
    const isModal = interaction.isModalSubmit() && interaction.customId.startsWith(`${More.MODAL_PREFIX}:`);
    if (!isSelect && !isModal) return;

    const refuse = (text) => interaction.reply({ content: S.withErrorMark(text), flags: MessageFlags.Ephemeral }).catch(() => {});

    const state = More.decodeState(interaction.customId);
    if (!state) return refuse("알 수 없는 메뉴예요.");

    const message = interaction.message;

    // 그만 넣기. 넣은 사람이면 시간이 지났든 권한이 바뀌었든 바로 지운다
    if (isSelect && interaction.values[0] === "stop") {
      if (state.requesterId && state.requesterId !== interaction.user.id) return refuse("목록을 넣은 사람만 닫을 수 있어요.");
      if (message) More.clearExpiry(message.id);
      await interaction.deferUpdate().catch(() => {});
      return interaction.deleteReply().catch(() => {});
    }

    const lastTouched = message?.editedTimestamp ?? message?.createdTimestamp ?? 0;
    const clickErr = More.clickError(state, { userId: interaction.user.id, lastTouched });
    if (clickErr) return refuse(clickErr);

    const permErr = checkAdd(interaction.member);
    if (permErr) return refuse(permErr);

    const player = interaction.client.players.get(interaction.guild.id);
    if (!player) return refuse(S.ERR_NO_MUSIC);

    let count;
    if (isSelect) {
      const value = interaction.values[0];
      if (value === "custom") {
        const room = More.roomFor(player);
        if (room <= 0) return refuse("대기열이 가득 차 지금은 더 넣을 수 없어요.");
        return interaction.showModal(More.countModal(state, Number.isFinite(room) ? room : More.MAX_COUNT, GuildSettingsManager.resolvePlaylistAddMax(interaction.guild.id)));
      }
      count = More.parseCount(value);
    } else {
      count = More.parseCount(interaction.fields.getTextInputValue("count"));
    }
    if (!count) return refuse("넣을 곡 수를 1 이상의 숫자로 적어 주세요.");

    // 메뉴를 떼어 두 번 누르지 못하게 하면서 3초 안에 응답한다
    if (message) More.clearExpiry(message.id);
    await interaction.update({ content: "⏳ 곡을 가져오는 중…", components: [] });

    let lastEdit = 0;
    const onProgress = (done, want) => {
      const now = Date.now();
      if (done >= want || now - lastEdit < PROGRESS_EVERY_MS) return;
      lastEdit = now;
      interaction.editReply({ content: `⏳ ${done}/${want}곡 가져오는 중…` }).catch(() => {});
    };

    let payload;
    try {
      const result = await continueCollection(interaction.client, {
        guild: interaction.guild,
        requester: interaction.member,
        state,
        count,
        textChannel: interaction.channel,
        voiceChannel: interaction.member.voice?.channel ?? null,
        onProgress,
      });
      payload = result.success ? More.resultMessage(state, result, More.roomFor(player)) : { content: S.withErrorMark(result.message), components: [] };
    } catch (error) {
      log.error("재생목록 더 넣기 실패:", error);
      payload = { content: S.ERR_PROCESSING, components: [] };
    }

    await interaction.editReply(payload).catch(() => {});
    if (message) More.expireLater(message.id, () => interaction.deleteReply());
  },
};
