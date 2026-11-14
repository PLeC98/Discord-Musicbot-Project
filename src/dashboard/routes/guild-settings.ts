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
import { openGuild } from "../guild-access.ts";
import { parse, settingsPatch, ToggleBody } from "../request-schemas.ts";
import { sendProblem, refuseWith } from "../problem.ts";
import type { Problem } from "../../rules/problems.ts";
import { DJ_ROLE_MAX } from "../../rules/limits.ts";
import type { GuildSettings, NormalizeCard, Saved, SettingsCard, SettingsConflict, SettingsSaved, StayCard } from "../contract/guilds.ts";
import { keysOf, pickValues, withValue, type SettingsKey, type SettingsValues } from "../../rules/guild-settings-values.ts";
import { conflictsOf, shownValues } from "../settings-values.ts";
import type { BotContext } from "../../app/bot-context.ts";
import * as stay from "../../usecases/stay.ts";
import * as normalize from "../../usecases/normalize.ts";
import * as replies from "../../ui/control-replies.ts";
import { announcer, dashboardActor } from "../discord-notice.ts";
import { viewerOf, shownCards, editsAny, noCardRefusal, noBodyCardRefusal, cardRefusal, fieldRefusal } from "../settings-cards.ts";

/** 검사를 통과한 본문. 필드마다 { from, to } 가 들어 있고, 없는 필드는 그대로 둔다 */
type SettingsBody = z.output<ReturnType<typeof settingsPatch>>;
/** 반영할 것. patch: 저장소에 넘길 것, keys: 보낸 키, from: 화면이 읽은 값, to: 거른 뒤의 바꿀 값 */
type SettingsPlan = { patch: GuildSettingsManager.GuildPatch; keys: SettingsKey[]; from: SettingsValues; to: SettingsValues };

// 본문을 이 서버에 맞춰 반영할 값으로 바꾼다. 서버에 없는 역할, 모르는 구간은 거르고, 받을 수 없는 값이면 그 문제를 돌려준다.
// SponsorBlock 은 보낸 하위 키만 넣는다(빠진 하위 키를 채우면 켜기만 바꿀 때 구간 설정이 지워진다)
function planSettings(guild: Guild, body: SettingsBody): SettingsPlan | { refused: Problem } {
  const patch: GuildSettingsManager.GuildPatch = {};
  let from: SettingsValues = {};
  let to: SettingsValues = {};
  const put = (key: SettingsKey, read: unknown, value: unknown) => {
    from = withValue(from, key, read);
    to = withValue(to, key, value);
  };

  if (body.djRoleIds) {
    const roles = [...new Set(body.djRoleIds.to)].filter((id) => isDjRoleCandidate(guild, id));
    // 디스코드 /setting 의 역할 선택 메뉴와 같은 상한
    if (roles.length > DJ_ROLE_MAX) return { refused: { code: "too-many-dj-roles", max: DJ_ROLE_MAX } };
    patch.djRoleIds = roles;
    put("djRoleIds", body.djRoleIds.from, roles);
  }

  if (body.botChannelId) {
    const channelId = body.botChannelId.to || null;
    if (channelId !== null && guild.channels.cache.get(channelId)?.type !== ChannelType.GuildText) return { refused: { code: "bad-bot-channel" } };
    patch.botChannelId = channelId;
    put("botChannelId", body.botChannelId.from, channelId);
  }

  if (body.sponsorblock?.enabled) {
    patch.sponsorBlock = { enabled: body.sponsorblock.enabled.to };
    put("sponsorblock.enabled", body.sponsorblock.enabled.from, body.sponsorblock.enabled.to);
  }
  if (body.sponsorblock?.categories) {
    const valid = new Set(SKIP_CATEGORIES);
    const categories = [...new Set(body.sponsorblock.categories.to.filter((c) => valid.has(c)))];
    patch.sponsorBlock = { ...patch.sponsorBlock, categories };
    put("sponsorblock.categories", body.sponsorblock.categories.from, categories);
  }

  if (body.playlistAddMax) {
    patch.playlistAddMax = body.playlistAddMax.to;
    put("playlistAddMax", body.playlistAddMax.from, body.playlistAddMax.to);
  }

  if (body.agePlace) {
    patch.agePlace = body.agePlace.to;
    put("agePlace", body.agePlace.from, body.agePlace.to);
  }
  return { patch, keys: keysOf(to), from, to };
}

const fieldNames = (fields: GuildSettingsManager.GuildField[]) => fields.map((field) => GuildSettingsManager.FIELD_LABEL[field]).join(", ");

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

// 값이 있는 카드(전용 채널, DJ 역할, SponsorBlock, 곡 수, 연령 제한)의 GET 응답. 보이는 카드만 담고, 고를 목록과 범위도 함께 싣는다
function cardValuesOf(guild: Guild, cards: readonly SettingsCard[], values: SettingsValues): Partial<GuildSettings> {
  const reply: Partial<GuildSettings> = {};
  if (cards.includes("channel")) {
    // /setchannel과 동일하게 일반 텍스트 채널만
    const channels = [...guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildText)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name }));
    reply.channel = { botChannelId: values.botChannelId ?? null, channels };
  }

  if (cards.includes("dj")) {
    // @everyone 은 제외("전원 DJ"는 미설정이 이미 그 의미), 봇 역할도 제외(사람에게 줄 수 없다)
    const roles = [...guild.roles.cache.values()]
      .filter((r) => isDjRoleCandidate(guild, r.id))
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : null }));
    reply.dj = { djRoleIds: values.djRoleIds ?? [], roles };
  }

  if (cards.includes("sponsorblock")) {
    reply.sponsorblock = { masterEnabled: config.sponsorblock.enabled, enabled: values.sponsorblock?.enabled ?? true, categories: values.sponsorblock?.categories ?? null, defaultCategories: [...config.sponsorblock.categories] };
  }

  // 재생목록 한 번에 넣는 곡 수. 저장값(null=기본), 실제 값, 설정할 수 있는 범위
  if (cards.includes("playlistAdd")) {
    reply.playlistAdd = { value: values.playlistAddMax ?? null, effective: GuildSettingsManager.resolvePlaylistAddMax(guild.id), ...GuildSettingsManager.playlistAddLimits() };
  }

  if (cards.includes("agePlace")) reply.agePlace = values.agePlace;

  return reply;
}

function createGuildSettingsRouter() {
  const router = express.Router();

  // 서버 설정 조회. 보는 사람에게 보이는 카드와 그 카드의 값만 싣는다(안 보이는 카드의 역할, 채널 목록은 보내지 않는다).
  // 값은 캐시가 아니라 행을 읽어 만든다. 못 읽으면 오류 처리에 맡긴다(기본값을 보여 주면 그것을 기준으로 저장하게 된다)
  router.get("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    const cards = shownCards(await viewerOf(req, member));
    if (!cards.length) return sendProblem(res, noCardRefusal());
    const reply: GuildSettings = { guildName: guild.name, cards };

    if (cards.includes("stay")) reply.stay = await stayCardOf(bot, guild, member);
    if (cards.includes("normalize")) reply.normalize = await normalizeCardOf(guild, member);

    Object.assign(reply, cardValuesOf(guild, cards, shownValues(guild, GuildSettingsManager.read(guild.id))));

    res.json(reply);
  });

  // 서버 설정을 바꾼다(바꾸는 필드만 화면이 읽은 값과 함께 받는다). 필드마다 그 카드를 고칠 수 있는 계층이어야 하고(서버 관리자 카드는 /setting, /setchannel과 같은 기준),
  // 하나라도 막히거나 틀리거나 그사이 다른 곳에서 바꿨으면 아무것도 반영하지 않는다. 운영자가 끈 기능의 카드(연령 제한)도 고칠 수 있는 계층이면 저장한다(켜면 쓰인다)
  router.patch("/:guildId/settings", requireAuth, async (req, res) => {
    const ctx = await openGuild(req, res, req.params.guildId);
    if (!ctx) return;
    const { guild, member, bot } = ctx;

    const viewer = await viewerOf(req, member);
    if (!editsAny(viewer)) return sendProblem(res, noBodyCardRefusal());

    const limits = GuildSettingsManager.playlistAddLimits();
    const body = parse(settingsPatch(limits), req.body ?? {});
    // 필드별 문제. 재생목록 곡 수는 범위를 같이 싣는다
    if (!body.ok) return sendProblem(res, "bad-settings", {}, { errors: body.errors.map((one) => (one.code === "playlist-limit-out-of-range" ? { ...one, min: limits.min, max: limits.max } : one)) });

    // 권한을 확인한 뒤에만 값을 비교한다(고칠 수 없는 카드의 지금 값을 알려 주지 않게)
    const denied = fieldRefusal(viewer, body.value);
    if (denied) return sendProblem(res, denied);

    const plan = planSettings(guild, body.value);
    if ("refused" in plan) return refuseWith(res, plan.refused);
    if (!plan.keys.length) return sendProblem(res, "nothing-to-save");

    let result: GuildSettingsManager.Updated;
    try {
      result = GuildSettingsManager.update(guild.id, plan.patch, (doc) => conflictsOf(guild, doc, plan.keys, plan.from, plan.to));
    } catch (error) {
      log.error(`서버 설정 저장 실패: ${guild.name} (${guild.id}) | ${fieldNames(Object.keys(plan.patch) as GuildSettingsManager.GuildField[])} | ${messageOf(error)}`);
      // 원래 오류 메시지는 응답에 싣지 않는다(어느 서버의 관리자든 부르는 경로다)
      return sendProblem(res, "settings-save-failed");
    }
    if (!result.ok) {
      return sendProblem(res, "config-changed", {}, { conflicts: result.conflicts, current: pickValues(shownValues(guild, result.doc), result.conflicts) } satisfies SettingsConflict);
    }
    if (result.changed.includes("botChannelId")) {
      bot.panels.onBotChannelChanged(guild).catch((error) => log.warn(`전용 채널 변경 후 패널 이동 실패: ${messageOf(error)}`));
    }

    if (result.changed.length) {
      const user = signedIn(req);
      log.info(`서버 설정 변경: ${guild.name} (${guild.id}) | ${fieldNames(result.changed)} | 실행 ${user.username || user.id}`);
    }
    res.json({ values: pickValues(shownValues(guild, result.doc), plan.keys) } satisfies SettingsSaved);
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
