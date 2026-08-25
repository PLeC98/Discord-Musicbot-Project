"use strict";

const { Events, EmbedBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const GuildSettingsManager = require("../src/GuildSettingsManager");
const SponsorBlock = require("../src/SponsorBlock");
const config = require("../config");

// /sponsorblock UI(카테고리 셀렉트 + 사용 토글 + 저장/취소) 처리.
// 셀렉트 선택값과 토글 상태를 저장 버튼이 읽을 수 있게 메시지 ID 기준으로 보류. (에페메랄이라 호출자만 조작)

const LABELS = {
  music_offtopic: "비음악 구간",
  intro: "인트로/인터미션",
  outro: "아웃트로/엔드카드",
  sponsor: "스폰서",
  selfpromo: "자기홍보",
  interaction: "상호작용(구독 유도)",
  preview: "프리뷰/요약",
  hook: "후킹/인사말",
  filler: "잡담/농담",
};

const pending = new Map(); // messageId → { enabled, categories, at }
const PENDING_TTL_MS = 15 * 60 * 1000;

function sweepPending() {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
}

function buildSponsorConfigMessage({ enabled, categories }) {
  const cats = new Set(categories);
  const lines = [config.sponsorblock.enabled ? "" : "⚠️ 봇 전역 설정에서 SponsorBlock이 꺼져 있어 이 설정은 적용되지 않습니다.", `현재: ${enabled ? "**사용**" : "**미사용**"}`, "", "건너뛸 구간 종류를 아래에서 고르고 **저장**을 누르세요. 사용 여부는 버튼으로 토글합니다."].filter((l) => l !== "");

  const embed = new EmbedBuilder().setTitle("⏭️ SponsorBlock 자동 스킵 설정").setDescription(lines.join("\n")).setColor("#5865F2");

  const select = new StringSelectMenuBuilder()
    .setCustomId("sb:cats")
    .setPlaceholder("건너뛸 구간 종류 선택")
    .setMinValues(0)
    .setMaxValues(SponsorBlock.SKIP_CATEGORIES.length)
    .addOptions(SponsorBlock.SKIP_CATEGORIES.map((id) => ({ label: LABELS[id] || id, value: id, default: cats.has(id) })));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("sb:toggle")
      .setLabel(enabled ? "사용 중 (끄기)" : "미사용 (켜기)")
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sb:save").setLabel("저장").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sb:cancel").setLabel("취소").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), buttons] };
}

function registerPending(messageId, state) {
  pending.set(messageId, { enabled: state.enabled, categories: [...state.categories], at: Date.now() });
}

module.exports = {
  name: Events.InteractionCreate,
  buildSponsorConfigMessage,
  registerPending,

  async execute(interaction) {
    const isSelect = interaction.isStringSelectMenu() && interaction.customId === "sb:cats";
    const isButton = interaction.isButton() && interaction.customId.startsWith("sb:");
    if (!isSelect && !isButton) return;

    sweepPending();

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "❌ 서버 관리 권한이 필요해요.", flags: MessageFlags.Ephemeral });
    }

    const mid = interaction.message.id;
    let state = pending.get(mid);
    if (!state) {
      // 보류 유실(봇 재시작 등) 시 현재 설정에서 복원
      const per = await GuildSettingsManager.getSponsorBlock(interaction.guild.id);
      const eff = GuildSettingsManager.resolveSponsorBlock(interaction.guild.id);
      state = { enabled: per.enabled === null ? true : per.enabled, categories: per.categories ?? eff.categories, at: Date.now() };
      pending.set(mid, state);
    }

    if (isSelect) {
      state.categories = [...interaction.values];
      state.at = Date.now();
      return interaction.deferUpdate();
    }

    if (interaction.customId === "sb:toggle") {
      state.enabled = !state.enabled;
      state.at = Date.now();
      return interaction.update(buildSponsorConfigMessage(state));
    }

    if (interaction.customId === "sb:cancel") {
      pending.delete(mid);
      return interaction.update({ embeds: [new EmbedBuilder().setTitle("⏭️ SponsorBlock 설정 취소됨").setDescription("변경 사항 없이 닫았어요.").setColor("#99AAB5")], components: [] });
    }

    if (interaction.customId === "sb:save") {
      pending.delete(mid);
      const valid = new Set(SponsorBlock.SKIP_CATEGORIES);
      const categories = [...new Set(state.categories.filter((c) => valid.has(c)))];
      await GuildSettingsManager.setSponsorBlock(interaction.guild.id, { enabled: state.enabled, categories });
      const summary = !state.enabled ? "미사용" : categories.length ? categories.map((c) => LABELS[c] || c).join(", ") : "선택된 구간 없음(사실상 미적용)";
      return interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("⏭️ SponsorBlock 설정 저장됨")
            .setDescription(`사용: **${state.enabled ? "예" : "아니오"}**\n구간: ${summary}`)
            .setColor("#57F287")
            .setTimestamp(),
        ],
        components: [],
      });
    }
  },
};
