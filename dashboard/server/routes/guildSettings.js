// 서버 설정(DJ 역할 · 전용 채널 · SponsorBlock · 재생목록 곡 수). 모더레이터와 봇 운영자만

import express from "express";
import logger from "../../../src/infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { ChannelType } from "discord.js";
import requireAuth from "../middleware/requireAuth.js";
import { isModerator } from "../../../src/usecases/permissions.ts";
import * as GuildSettingsManager from "../../../src/store/guildSettings.ts";
import * as SponsorBlock from "../../../src/sources/sponsorBlock.ts";
import config from "../../../config.ts";
import owner from "../owner.js";
const { isOwner } = owner;
import guildAccess from "../guildAccess.js";
const { getPlayer } = guildAccess;
import requestSchemas from "../requestSchemas.js";
const { parse, settingsBody } = requestSchemas;

// SponsorBlock 카테고리 라벨 (대시보드 표시용). SKIP_CATEGORIES와 키 일치
const SB_CATEGORY_LABELS = {
  music_offtopic: "음악이 아닌 구간",
  intro: "인트로/무음 구간",
  outro: "최종 화면 구간",
  sponsor: "후원이나 협찬 구간",
  selfpromo: "무대가 홍보 구간",
  interaction: "상호작용 알림 구간",
  preview: "미리보기/요약 구간",
  hook: "후킹/인사말",
  filler: "잡담/농담",
};

function createGuildSettingsRouter() {
  const router = express.Router();

  // ── Settings endpoints ────────────────────────────────────────────────────────

  // 서버 설정 조회. DJ 역할·봇 전용 채널 현황 + 드롭다운용 역할/채널 목록.
  // 조회·변경 모두 모더레이터/봇 운영자 전용 (사용자 결정. 일반 멤버는 ⚙ 진입 자체 불가).
  router.get("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member } = ctx;

    const canEdit = isOwner(req) || (member ? isModerator(member) : false);
    if (!canEdit) {
      return res.status(403).json({ error: "서버 설정은 모더레이터(서버 관리 권한)만 볼 수 있습니다" });
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
      available: SponsorBlock.SKIP_CATEGORIES.map((id) => ({ id, label: SB_CATEGORY_LABELS[id] || id })),
    };

    // 재생목록 한 번에 넣는 곡 수. 저장값(null=기본), 실제 값, 설정할 수 있는 범위
    const playlistAdd = {
      value: await GuildSettingsManager.getPlaylistAddMax(guild.id),
      effective: GuildSettingsManager.resolvePlaylistAddMax(guild.id),
      ...GuildSettingsManager.playlistAddLimits(),
    };

    res.json({ guildName: guild.name, canEdit, djRoleIds, botChannelId, roles, channels, sponsorblock, playlistAdd });
  });

  // 서버 설정 변경. 모더레이터/봇 운영자만. /setdjrole·/setchannel과 동일 기준.
  // 부분 적용 방지를 위해 전체 검증 후 일괄 반영.
  router.put("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, client } = ctx;

    if (!isOwner(req) && !(member && isModerator(member))) {
      return res.status(403).json({ error: "서버 설정을 변경할 권한이 없습니다 (서버 관리 권한 필요)" });
    }

    const body = parse(settingsBody(GuildSettingsManager.playlistAddLimits()), req.body ?? {});
    if (!body.ok) return res.status(400).json({ error: body.error });
    // 칸마다 undefined 는 변경 없음
    const { djRoleIds, botChannelId, sponsorblock, playlistAddMax: nextPlaylistAdd } = body.value;

    // SponsorBlock. 모르는 카테고리는 걸러 낸다
    let nextSponsor;
    if (sponsorblock !== undefined) {
      const valid = new Set(SponsorBlock.SKIP_CATEGORIES);
      const categories = sponsorblock.categories === undefined ? null : [...new Set(sponsorblock.categories.filter((c) => valid.has(c)))];
      nextSponsor = { enabled: sponsorblock.enabled, categories };
    }

    // DJ 역할. 이 서버에 없는 역할은 걸러 낸다
    let nextRoles = null;
    if (djRoleIds !== undefined) {
      nextRoles = [...new Set(djRoleIds)].filter((id) => id !== guild.id && guild.roles.cache.has(id));
      if (nextRoles.length > 25) {
        // 디스코드 /setdjrole GUI(셀렉트 메뉴 최대 25개)와 정합 유지
        return res.status(400).json({ error: "DJ 역할은 최대 25개까지 지정할 수 있습니다" });
      }
    }

    let nextChannel; // undefined=변경 없음, null=해제, string=지정
    if (botChannelId === null || botChannelId === "") {
      nextChannel = null;
    } else if (botChannelId !== undefined) {
      const ch = guild.channels.cache.get(botChannelId);
      if (!ch || ch.type !== ChannelType.GuildText) {
        return res.status(400).json({ error: "봇 전용 채널은 일반 텍스트 채널이어야 합니다" });
      }
      nextChannel = botChannelId;
    }

    // 반영
    if (nextRoles !== null) {
      if (nextRoles.length) await GuildSettingsManager.setDjRoles(guild.id, nextRoles);
      else await GuildSettingsManager.clearDjRoles(guild.id);
    }
    // 화면은 저장할 때마다 전용 채널을 함께 보낸다. 실제로 바뀌었을 때만 패널을 옮긴다
    let channelChanged = false;
    if (nextChannel !== undefined) {
      channelChanged = nextChannel !== (await GuildSettingsManager.getBotChannel(guild.id));
      if (nextChannel) await GuildSettingsManager.setBotChannel(guild.id, nextChannel);
      else await GuildSettingsManager.clearBotChannel(guild.id);
    }
    if (nextSponsor !== undefined) {
      await GuildSettingsManager.setSponsorBlock(guild.id, nextSponsor);
    }
    if (nextPlaylistAdd !== undefined) {
      await GuildSettingsManager.setPlaylistAddMax(guild.id, nextPlaylistAdd);
    }
    if (channelChanged) {
      client?.musicEmbedManager?.onBotChannelChanged(guild).catch((error) => log.warn(`전용 채널 변경 뒤 패널 옮기기 실패: ${error?.message || error}`));
    }

    log.info(`서버 설정 변경: ${guild.name} (${guild.id}). 실행 ${req.session.user.username || req.session.user.id}`);
    res.json({ success: true });
  });

  return router;
}

const exported = { createGuildSettingsRouter };
export default exported;
export { exported as "module.exports" };
