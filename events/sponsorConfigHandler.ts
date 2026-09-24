import { Events, EmbedBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import * as SponsorBlock from "../src/sources/sponsorBlock.ts";
import config from "../config.ts";
import type { ClientEvent } from "../src/app/main.ts";

// /sponsorblock UI(카테고리 셀렉트 + 사용 토글 + 저장/취소) 처리.
// 셀렉트 선택값과 토글 상태를 저장 버튼이 읽을 수 있게 메시지 ID 기준으로 보류. (에페메랄이라 호출자만 조작)

const LABELS: Record<string, string> = {
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

/** 저장 전의 설정. 셀렉트 · 토글이 고치고 저장 버튼이 읽는다 */
type Draft = { enabled: boolean; categories: string[] };
const pending = new Map<string, Draft & { at: number }>(); // messageId → { enabled, categories, at }
const PENDING_TTL_MS = 15 * 60 * 1000;

function sweepPending() {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
}

function buildSponsorConfigMessage({ enabled, categories }: Draft) {
  const cats = new Set(categories);
  const lines = [config.sponsorblock.enabled ? "" : "⚠️ 봇 전역 설정에서 SponsorBlock이 꺼져 있어 이 설정은 적용되지 않습니다.", `현재: ${enabled ? "**사용**" : "**미사용**"}`, "", "건너뛸 구간 종류를 아래에서 고르고 **저장**을 누르세요. 사용 여부는 버튼으로 토글합니다."].filter((l) => l !== "");

  const embed = new EmbedBuilder().setTitle("⏭️ SponsorBlock 자동 스킵 설정").setDescription(lines.join("\n")).setColor("#5865F2");

  const select = new StringSelectMenuBuilder()
    .setCustomId("sb:cats")
    .setPlaceholder("건너뛸 구간 종류 선택")
    .setMinValues(0)
    .setMaxValues(SponsorBlock.SKIP_CATEGORIES.length)
    .addOptions(SponsorBlock.SKIP_CATEGORIES.map((id) => ({ label: LABELS[id] || id, value: id, default: cats.has(id) })));

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sb:toggle")
      .setLabel(enabled ? "사용 중 (끄기)" : "미사용 (켜기)")
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sb:save").setLabel("저장").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sb:cancel").setLabel("취소").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), buttons] };
}

function registerPending(messageId: string, state: Draft) {
  pending.set(messageId, { enabled: state.enabled, categories: [...state.categories], at: Date.now() });
}

// 보류가 없으면(봇 재시작 등) 지금 설정에서 되살린다
async function restoreDraft(messageId: string, guildId: string) {
  const per = await GuildSettingsManager.getSponsorBlock(guildId);
  const eff = GuildSettingsManager.resolveSponsorBlock(guildId);
  const state = { enabled: per.enabled === null ? true : per.enabled, categories: per.categories ?? eff.categories, at: Date.now() };
  pending.set(messageId, state);
  return state;
}

// 저장하고 무엇을 저장했는지 한 줄로. 모르는 카테고리는 걸러 낸다
async function saveDraft(guildId: string, state: Draft) {
  const valid = new Set(SponsorBlock.SKIP_CATEGORIES);
  const categories = [...new Set(state.categories.filter((c) => valid.has(c)))];
  await GuildSettingsManager.setSponsorBlock(guildId, { enabled: state.enabled, categories });
  if (!state.enabled) return "미사용";
  return categories.length ? categories.map((c) => LABELS[c] || c).join(", ") : "선택된 구간 없음(사실상 미적용)";
}

const exported: ClientEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    const isSelect = interaction.isStringSelectMenu() && interaction.customId === "sb:cats";
    const isButton = interaction.isButton() && interaction.customId.startsWith("sb:");
    if (!isSelect && !isButton) return;
    if (!interaction.inCachedGuild()) return;

    sweepPending();

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "❌ 서버 관리 권한이 필요해요.", flags: MessageFlags.Ephemeral });
    }

    const mid = interaction.message.id;
    const state = pending.get(mid) ?? (await restoreDraft(mid, interaction.guild.id));

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
      const summary = await saveDraft(interaction.guild.id, state);
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
export default exported;
export { buildSponsorConfigMessage, registerPending };
