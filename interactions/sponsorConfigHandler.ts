import { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import { SKIP_CATEGORIES, categoryLabel } from "../src/rules/sponsorCategories.ts";
import config from "../config.ts";
import { route, type Route } from "./route.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as settingsText from "../src/ui/text/settings.ts";
import * as errors from "../src/ui/text/errors.ts";
import { noticeReply } from "../src/ui/frame.ts";

// /sponsorblock UI(카테고리 셀렉트 + 사용 토글 + 저장/취소) 처리.
// 셀렉트 선택값과 토글 상태를 저장 버튼이 읽을 수 있게 메시지 ID 기준으로 보류. (에페메랄이라 호출자만 조작)

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
  const t = settingsText.sponsorMenu({ enabled, globalOff: !config.sponsorblock.enabled });
  const embed = new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("brand"));

  const select = new StringSelectMenuBuilder()
    .setCustomId("sb:cats")
    .setPlaceholder(t.placeholder)
    .setMinValues(0)
    .setMaxValues(SKIP_CATEGORIES.length)
    .addOptions(SKIP_CATEGORIES.map((id) => ({ label: categoryLabel(id), value: id, default: cats.has(id) })));

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sb:toggle")
      .setLabel(t.toggle)
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sb:save").setLabel(settingsText.buttons().save).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sb:cancel").setLabel(settingsText.buttons().cancel).setStyle(ButtonStyle.Secondary),
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
  const valid = new Set(SKIP_CATEGORIES);
  const categories = [...new Set(state.categories.filter((c) => valid.has(c)))];
  await GuildSettingsManager.setSponsorBlock(guildId, { enabled: state.enabled, categories });
  return settingsText.sponsorSummary(state.enabled, categories.map(categoryLabel));
}

// 구간 종류 메뉴(sb:cats)와 사용 토글 · 저장 · 취소 버튼(sb:)
async function handleSponsorConfig(interaction: StringSelectMenuInteraction<"cached"> | ButtonInteraction<"cached">) {
  sweepPending();

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply(noticeReply(errors.needManageGuild()));
  }

  const mid = interaction.message.id;
  const state = pending.get(mid) ?? (await restoreDraft(mid, interaction.guild.id));

  if (interaction.isStringSelectMenu()) {
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
    const t = settingsText.sponsorCancelled();
    return interaction.update({ embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("brand"))], components: [] });
  }

  if (interaction.customId === "sb:save") {
    pending.delete(mid);
    const t = settingsText.sponsorSaved(state.enabled, await saveDraft(interaction.guild.id, state));
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("done")).setTimestamp()],
      components: [],
    });
  }
}

const routes: Route[] = [route("select", "sb:cats", handleSponsorConfig), route("button", "sb:", handleSponsorConfig)];

export { routes, buildSponsorConfigMessage, registerPending };
