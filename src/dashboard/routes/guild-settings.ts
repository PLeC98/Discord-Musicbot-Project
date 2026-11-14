// 서버 설정(DJ 역할, 전용 채널, SponsorBlock, 재생목록 곡 수, 연령 제한 콘텐츠 재생 위치). 카드마다 볼 수 있는 계층은 dashboard/settings-cards 의 표(봇 운영자도 해당 서버의 권한을 따른다)

import express from "express";
import logger from "../../infra/log/logger.ts";
import { messageOf } from "../../rules/error-kind.ts";
const log = logger.child({ category: "dashboard" });
import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember } from "discord.js";
import type { z } from "zod";
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { assertSignedIn, sessionEnded } from "../session-requests.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { leaveGuild } from "../../usecases/leave-guild.ts";
import { isDjRoleCandidate } from "../../usecases/permissions.ts";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { SKIP_CATEGORIES } from "../../rules/sponsor-categories.ts";
import config from "../../config/index.ts";
import type { AgePlace } from "../../rules/age-place.ts";
import { openGuild } from "../guild-access.ts";
import { parse, settingsBody, ToggleBody } from "../request-schemas.ts";
import { sendProblem, refuseWith } from "../problem.ts";
import type { Problem } from "../../rules/problems.ts";
import { DJ_ROLE_MAX } from "../../rules/limits.ts";
import type { GuildSettings, NormalizeCard, Saved, StayCard } from "../contract/guilds.ts";
import type { BotContext } from "../../app/bot-context.ts";
import * as stay from "../../usecases/stay.ts";
import * as normalize from "../../usecases/normalize.ts";
import * as replies from "../../ui/control-replies.ts";
import { announcer, dashboardActor } from "../discord-notice.ts";
import { viewerOf, shownCards, editsAny, noCardRefusal, noBodyCardRefusal, cardRefusal, fieldRefusal } from "../settings-cards.ts";

/** 검사를 지난 본문. 필드마다 undefined 는 변경 없음 */
type SettingsBody = z.output<ReturnType<typeof settingsBody>>;
/** 반영할 것. undefined 는 변경 없음, null 은 해제 */
type SettingsPlan = { roles?: string[]; channel?: string | null; sponsor?: { enabled: boolean | null; categories: string[] | null }; playlistAdd?: number | null; agePlace?: AgePlace };

// 본문을 이 서버에 맞춰 반영할 것으로. 서버에 없는 역할, 모르는 카테고리는 필터링하고, 받을 수 없는 값이면 그 문제
function planSettings(guild: Guild, { djRoleIds, botChannelId, sponsorblock, playlistAddMax, agePlace }: SettingsBody): SettingsPlan | { refused: Problem } {
  const plan: SettingsPlan = { playlistAdd: playlistAddMax, agePlace };

  if (sponsorblock !== undefined) {
    const valid = new Set(SKIP_CATEGORIES);
    const categories = sponsorblock.categories === undefined ? null : [...new Set(sponsorblock.categories.filter((c) => valid.has(c)))];
    plan.sponsor = { enabled: sponsorblock.enabled, categories };
  }

  if (djRoleIds !== undefined) {
    plan.roles = [...new Set(djRoleIds)].filter((id) => isDjRoleCandidate(guild, id));
    // 디스코드 /setting 의 역할 선택 메뉴와 같은 상한
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

const fieldNames = (fields: GuildSettingsManager.GuildField[]) => fields.map((field) => GuildSettingsManager.FIELD_LABEL[field]).join(", ");

// 저장소에 넘길 패치. 계획에 든 것만 싣는다(빠진 것은 그대로)
function patchOf({ roles, channel, sponsor, playlistAdd, agePlace }: SettingsPlan): GuildSettingsManager.GuildPatch {
  return {
    ...(roles !== undefined && { djRoleIds: roles }),
    ...(channel !== undefined && { botChannelId: channel }),
    ...(sponsor !== undefined && { sponsorBlock: sponsor }),
    ...(playlistAdd !== undefined && { playlistAddMax: playlistAdd }),
    ...(agePlace !== undefined && { agePlace }),
  };
}

// 상주 모드 카드: 켜졌는지, 머무는 채널(보는 사람이 볼 수 있는 채널만. 비공개 채널의 이름을 알리지 않는다), 지금 바꿀 수 없는 까닭(켜고 끄기와 같은 확인, usecases/stay)
async function stayCardOf(bot: BotContext, guild: Guild, member: GuildMember): Promise<StayCard> {
  const seat = stay.seatChannelOf(guild.id);
  const found = seat ? guild.channels.cache.get(seat) : undefined;
  const visible = found?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) ?? false;
  return { on: seat !== null, channel: found && visible ? { id: found.id, name: found.name } : null, refusal: await stay.stayRefusal(bot, member) };
}

// 볼륨 정규화 카드: 켜졌는지, 지금 바꿀 수 없는 까닭(켜고 끄기와 같은 확인, usecases/normalize)
async function normalizeCardOf(guild: Guild, member: GuildMember): Promise<NormalizeCard> {
  return { on: normalize.normalizeOn(guild.id), refusal: await normalize.normalizeRefusal(member) };
}

function createGuildSettingsRouter() {
  const router = express.Router();

  // 서버 설정 조회. 보는 사람에게 보이는 카드와 그 카드의 값만 싣는다(안 보이는 카드의 역할, 채널 목록은 보내지 않는다)
  router.get("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    const cards = shownCards(await viewerOf(req, member));
    if (!cards.length) return sendProblem(res, noCardRefusal());
    const reply: GuildSettings = { guildName: guild.name, cards };

    if (cards.includes("stay")) reply.stay = await stayCardOf(bot, guild, member);
    if (cards.includes("normalize")) reply.normalize = await normalizeCardOf(guild, member);

    if (cards.includes("channel")) {
      const rawChannelId = await GuildSettingsManager.getBotChannel(guild.id);
      // /setchannel과 동일하게 일반 텍스트 채널만
      const channels = [...guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildText)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => ({ id: c.id, name: c.name }));
      reply.channel = { botChannelId: rawChannelId && guild.channels.cache.has(rawChannelId) ? rawChannelId : null, channels };
    }

    if (cards.includes("dj")) {
      const djRoleIds = (await GuildSettingsManager.getDjRoles(guild.id)).filter((id) => isDjRoleCandidate(guild, id));
      // @everyone 은 제외("전원 DJ"는 미설정이 이미 그 의미), 봇 역할도 제외(사람에게 줄 수 없다)
      const roles = [...guild.roles.cache.values()]
        .filter((r) => isDjRoleCandidate(guild, r.id))
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : null }));
      reply.dj = { djRoleIds, roles };
    }

    if (cards.includes("sponsorblock")) {
      const sbEff = GuildSettingsManager.resolveSponsorBlock(guild.id);
      // 전역 off면 서버 설정 무의미
      reply.sponsorblock = { masterEnabled: config.sponsorblock.enabled, enabled: sbEff.enabled, categories: sbEff.categories };
    }

    // 재생목록 한 번에 넣는 곡 수. 저장값(null=기본), 실제 값, 설정할 수 있는 범위
    if (cards.includes("playlistAdd")) {
      reply.playlistAdd = { value: await GuildSettingsManager.getPlaylistAddMax(guild.id), effective: GuildSettingsManager.resolvePlaylistAddMax(guild.id), ...GuildSettingsManager.playlistAddLimits() };
    }

    if (cards.includes("agePlace")) reply.agePlace = GuildSettingsManager.resolveAgePlace(guild.id);

    res.json(reply);
  });

  // 서버 설정을 변경한다. 필드마다 그 카드를 고칠 수 있는 계층이어야 하고(서버 관리자 카드는 /setting, /setchannel과 같은 기준),
  // 하나라도 막히거나 틀리면 아무것도 반영하지 않는다. 운영자가 끈 기능의 카드(연령 제한)도 고칠 수 있는 계층이면 저장한다(켜면 쓰인다)
  router.put("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    const viewer = await viewerOf(req, member);
    if (!editsAny(viewer)) return sendProblem(res, noBodyCardRefusal());

    const limits = GuildSettingsManager.playlistAddLimits();
    const body = parse(settingsBody(limits), req.body ?? {});
    // 필드별 문제. 재생목록 곡 수는 범위를 같이 싣는다
    if (!body.ok) return sendProblem(res, "bad-settings", {}, { errors: body.errors.map((one) => (one.code === "playlist-limit-out-of-range" ? { ...one, min: limits.min, max: limits.max } : one)) });

    const denied = fieldRefusal(viewer, body.value);
    if (denied) return sendProblem(res, denied);

    const plan = planSettings(guild, body.value);
    if ("refused" in plan) return refuseWith(res, plan.refused);
    const patch = patchOf(plan);
    let changed: GuildSettingsManager.GuildField[];
    try {
      const result = GuildSettingsManager.update(guild.id, patch);
      changed = result.ok ? result.changed : [];
    } catch (error) {
      log.error(`서버 설정 저장 실패: ${guild.name} (${guild.id}) | ${fieldNames(Object.keys(patch) as GuildSettingsManager.GuildField[])} | ${messageOf(error)}`);
      // 원래 오류 메시지는 응답에 싣지 않는다(어느 서버의 관리자든 부르는 경로다)
      return sendProblem(res, "settings-save-failed");
    }
    if (changed.includes("botChannelId")) {
      bot.panels.onBotChannelChanged(guild).catch((error) => log.warn(`전용 채널 변경 후 패널 이동 실패: ${messageOf(error)}`));
    }

    if (changed.length) {
      const user = signedIn(req);
      log.info(`서버 설정 변경: ${guild.name} (${guild.id}) | ${fieldNames(changed)} | 실행 ${user.username || user.id}`);
    }
    res.json({ success: true } satisfies Saved);
  });

  // 상주 모드 켜기, 끄기 { on }. 디스코드 /247 과 같은 처리(usecases/stay). 바뀐 결과는 디스코드의 패널 채널에도 알린다. 답은 바뀐 뒤의 카드
  router.post("/:guildId/settings/stay", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    if (!shownCards(await viewerOf(req, member)).includes("stay")) return sendProblem(res, cardRefusal("stay"));
    const body = parse(ToggleBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);

    const r = body.value.on ? await stay.turnOn(bot, { guild, member }, { go: () => assertSignedIn(req) }) : await stay.turnOff(bot, { guild, member });
    if (!r.ok) return sendProblem(res, r.code);
    if (!r.already) {
      const view = r.kind === "on" ? replies.stayOn(r.channelId, false, dashboardActor(req)) : replies.stayOff(false, dashboardActor(req));
      announcer(bot, bot.players.get(guild.id))(view);
    }
    res.json(await stayCardOf(bot, guild, member));
  });

  // 볼륨 정규화 켜기, 끄기 { on }. 디스코드 /normalize 와 같은 처리(usecases/normalize). 바뀐 결과는 디스코드의 패널 채널에도 알린다. 응답은 바뀐 뒤의 카드
  router.post("/:guildId/settings/normalize", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    // 카드 계층을 먼저 보지 않는다. 판정은 /normalize 와 같은 순서(usecases/normalize 의 checkControl: 같은 음성 채널, 그다음 DJ)로 하나다
    const body = parse(ToggleBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code);

    const r = await normalize.setNormalize({ guild, member }, body.value.on);
    if (!r.ok) return sendProblem(res, r.code);
    if (!r.already) announcer(bot, bot.players.get(guild.id))(replies.normalizeSet(r.on, false, dashboardActor(req)));
    res.json(await normalizeCardOf(guild, member));
  });

  // 봇 내보내기. 디스코드에서 봇을 추방할 수 있는 사람만(카드 표의 kick-bot, 판정은 이 요청 때 다시). 되돌릴 수 없어 로그인한 지 오래되면 다시 로그인하게 한다.
  // 정리하고 나가는 순서는 usecases/leave-guild. 나간 뒤 그 서버를 보던 화면은 서버 목록으로 간다
  router.post("/:guildId/settings/leave", requireAuth, requireRecentLogin, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    if (!shownCards(await viewerOf(req, member)).includes("leave")) return sendProblem(res, cardRefusal("leave"));
    // 이름은 바꿀 수 있어 사용자 id 를 함께 남긴다(나간 서버에는 기록이 남지 않는다)
    const user = signedIn(req);
    const who = `${user.username || "?"} (${user.id})`;
    try {
      await leaveGuild(bot.players, guild, { reason: "대시보드 서버 설정에서 봇 내보내기", end: "dashboard-leave", go: () => assertSignedIn(req) });
      log.info(`대시보드 서버 설정에서 봇 내보내기: ${guild.name} (${guild.id}). 실행 ${who}`);
      res.json({ success: true } satisfies Saved);
    } catch (error) {
      if (sessionEnded(res, error)) return void log.warn(`대시보드에서 봇 내보내기 멈춤(로그인 세션 끝남): ${guild.name} (${guild.id}). 실행 ${who}`);
      log.error(`대시보드에서 봇 내보내기 실패: ${guild.name} (${guild.id}). 실행 ${who}:`, error);
      sendProblem(res, "leave-guild-failed", {}, { detail: messageOf(error) });
    }
  });

  return router;
}

export { createGuildSettingsRouter };
