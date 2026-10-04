// 서버 설정(DJ 역할 · 전용 채널 · SponsorBlock · 재생목록 곡 수). 모더레이터와 봇 운영자만

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { ChannelType, type Guild } from "discord.js";
import type { z } from "zod";
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { isModerator } from "../../usecases/permissions.ts";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { SKIP_CATEGORIES, categoryLabel } from "../../rules/sponsor-categories.ts";
import config from "../../config/index.ts";
import { isOwner } from "../owner.ts";
import { openGuild } from "../guild-access.ts";
import { parse, settingsBody } from "../request-schemas.ts";
import { sendProblem, refuseWith } from "../problem.ts";
import type { Problem } from "../../rules/problems.ts";
import { DJ_ROLE_MAX } from "../../rules/limits.ts";
import type { GuildSettings, Saved } from "../contract/guilds.ts";

/** 검사를 지난 본문. 칸마다 undefined 는 변경 없음 */
type SettingsBody = z.output<ReturnType<typeof settingsBody>>;
/** 반영할 것. undefined 는 변경 없음, null 은 해제 */
type SettingsPlan = { roles?: string[]; channel?: string | null; sponsor?: { enabled: boolean | null; categories: string[] | null }; playlistAdd?: number | null };

// 본문을 이 서버에 맞춰 반영할 것으로. 서버에 없는 역할 · 모르는 카테고리는 걸러 내고, 받을 수 없는 값이면 그 문제
function planSettings(guild: Guild, { djRoleIds, botChannelId, sponsorblock, playlistAddMax }: SettingsBody): SettingsPlan | { refused: Problem } {
  const plan: SettingsPlan = { playlistAdd: playlistAddMax };

  if (sponsorblock !== undefined) {
    const valid = new Set(SKIP_CATEGORIES);
    const categories = sponsorblock.categories === undefined ? null : [...new Set(sponsorblock.categories.filter((c) => valid.has(c)))];
    plan.sponsor = { enabled: sponsorblock.enabled, categories };
  }

  if (djRoleIds !== undefined) {
    plan.roles = [...new Set(djRoleIds)].filter((id) => id !== guild.id && guild.roles.cache.has(id));
    // 디스코드 /setdjrole 의 역할 선택 메뉴와 같은 상한
    if (plan.roles.length > DJ_ROLE_MAX) return { refused: { code: "too-many-dj-roles", max: DJ_ROLE_MAX } };
  }

  if (botChannelId === null || botChannelId === "") plan.channel = null;
  else if (botChannelId !== undefined) {
    const ch = guild.channels.cache.get(botChannelId);
    if (!ch || ch.type !== ChannelType.GuildText) return { refused: { code: "bad-bot-channel" } };
    plan.channel = botChannelId;
  }
  return plan;
}

// 반영한다. 전용 채널이 실제로 바뀌었나(화면은 저장할 때마다 전용 채널을 함께 보낸다. 바뀌었을 때만 패널을 옮긴다)
async function applySettings(guild: Guild, { roles, channel, sponsor, playlistAdd }: SettingsPlan) {
  if (roles !== undefined) {
    if (roles.length) await GuildSettingsManager.setDjRoles(guild.id, roles);
    else await GuildSettingsManager.clearDjRoles(guild.id);
  }
  let channelChanged = false;
  if (channel !== undefined) {
    channelChanged = channel !== (await GuildSettingsManager.getBotChannel(guild.id));
    if (channel) await GuildSettingsManager.setBotChannel(guild.id, channel);
    else await GuildSettingsManager.clearBotChannel(guild.id);
  }
  if (sponsor !== undefined) await GuildSettingsManager.setSponsorBlock(guild.id, sponsor);
  if (playlistAdd !== undefined) await GuildSettingsManager.setPlaylistAddMax(guild.id, playlistAdd);
  return channelChanged;
}

function createGuildSettingsRouter() {
  const router = express.Router();

  // ── Settings endpoints ────────────────────────────────────────────────────────

  // 서버 설정 조회. DJ 역할·봇 전용 채널 현황 + 드롭다운용 역할/채널 목록.
  // 조회·변경 모두 모더레이터/봇 운영자 전용 (사용자 결정. 일반 멤버는 ⚙ 진입 자체 불가).
  router.get("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member } = ctx;

    const canEdit = isOwner(req) || (member ? isModerator(member) : false);
    if (!canEdit) {
      return sendProblem(res, "must-moderator");
    }

    const djRoleIds = (await GuildSettingsManager.getDjRoles(guild.id)).filter((id) => guild.roles.cache.has(id));
    const rawChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    const botChannelId = rawChannelId && guild.channels.cache.has(rawChannelId) ? rawChannelId : null;

    // @everyone(서버 ID와 동일)은 제외. "전원 DJ"는 미설정이 이미 그 의미
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : null }));

    // /setchannel과 동일하게 일반 텍스트 채널만
    const channels = [...guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildText)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name }));

    // SponsorBlock 서버별 설정 (유효값 + 마스터 상태 + 카테고리 목록)
    const sbEff = GuildSettingsManager.resolveSponsorBlock(guild.id);
    const sponsorblock = {
      masterEnabled: config.sponsorblock.enabled, // 전역 off면 서버 설정 무의미
      enabled: sbEff.enabled,
      categories: sbEff.categories,
      available: SKIP_CATEGORIES.map((id) => ({ id, label: categoryLabel(id) })),
    };

    // 재생목록 한 번에 넣는 곡 수. 저장값(null=기본), 실제 값, 설정할 수 있는 범위
    const playlistAdd = {
      value: await GuildSettingsManager.getPlaylistAddMax(guild.id),
      effective: GuildSettingsManager.resolvePlaylistAddMax(guild.id),
      ...GuildSettingsManager.playlistAddLimits(),
    };

    res.json({ guildName: guild.name, canEdit, djRoleIds, botChannelId, roles, channels, sponsorblock, playlistAdd } satisfies GuildSettings);
  });

  // 서버 설정 변경. 모더레이터/봇 운영자만. /setdjrole·/setchannel과 동일 기준.
  // 부분 적용 방지를 위해 전체 검증 후 일괄 반영.
  router.put("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    if (!isOwner(req) && !(member && isModerator(member))) {
      return sendProblem(res, "must-moderator");
    }

    const limits = GuildSettingsManager.playlistAddLimits();
    const body = parse(settingsBody(limits), req.body ?? {});
    // 칸별 문제. 재생목록 곡 수는 범위를 같이 싣는다
    if (!body.ok) return sendProblem(res, "bad-settings", {}, { errors: body.errors.map((one) => (one.code === "playlist-limit-out-of-range" ? { ...one, min: limits.min, max: limits.max } : one)) });

    const plan = planSettings(guild, body.value);
    if ("refused" in plan) return refuseWith(res, plan.refused);
    const channelChanged = await applySettings(guild, plan);
    if (channelChanged) {
      bot.panels.onBotChannelChanged(guild).catch((error) => log.warn(`전용 채널 변경 뒤 패널 옮기기 실패: ${error?.message || error}`));
    }

    const user = signedIn(req);
    log.info(`서버 설정 변경: ${guild.name} (${guild.id}). 실행 ${user.username || user.id}`);
    res.json({ success: true } satisfies Saved);
  });

  return router;
}

export { createGuildSettingsRouter };
