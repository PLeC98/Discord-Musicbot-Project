// 대시보드 경로가 서버 하나를 여는 법. 봇 준비 · 서버 있음 · 실멤버십 · 권한 수준 오버라이드.
// 봇 운영자도 참가한 서버만 열고, 그 서버 안에서는 그 서버의 권한대로다(ref-dashboard-security "서버 접근")

import { RESTJSONErrorCodes, type Guild, type GuildMember } from "discord.js";
import type { Request, Response } from "express";
import logger from "../infra/log/logger.ts";
import { codeOf, describeError } from "../rules/error-kind.ts";
import type { Actor } from "../usecases/controls.ts";
import { signedIn } from "./middleware/require-auth.ts";
import { shadowMember } from "./view-as.ts";
import { sendProblem } from "./problem.ts";
const log = logger.child({ category: "dashboard" });

/** 멤버 조회의 답: 멤버가 아니다 */
const NOT_MEMBER = new Set<unknown>([RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownUser]);

/** members.fetch 의 catch. 멤버가 아니라는 답은 조용히, 다른 실패는 까닭을 남긴다. 어느 쪽이든 null(멤버로 보지 않는다) */
const notMember = (guildId: string, userId: string) => (error: unknown) => {
  if (!NOT_MEMBER.has(codeOf(error))) log.debug(`멤버 조회 실패: 서버 ${guildId} · 사용자 ${userId} | ${describeError(error)}`);
  return null;
};

/** 멤버 판정에 쓰는 서버의 모양(시험의 가짜는 available 이 없으면 쓸 수 있는 것으로 본다) */
type MemberSource = { id: string; available?: boolean; members: { fetch(options: string | { user: string; force: boolean }): Promise<GuildMember> } };

/**
 * 이 사람이 지금 이 서버의 멤버인가(보고 조작하는 권한 판정의 한 입구). 멤버 캐시 → REST. 답은 따로 두지 않는다(두면 언제 낡을지 모른다).
 * 다시 붙은 직후 그 서버의 GUILD_CREATE 전에는(쓸 수 없는 서버) 옛 멤버가 캐시에 남아 있으므로 캐시를 건너뛰고 묻는다
 */
function memberOf(guild: MemberSource, userId: string): Promise<GuildMember | null> {
  const asked = guild.available === false ? guild.members.fetch({ user: userId, force: true }) : guild.members.fetch(userId);
  return asked.catch(notMember(guild.id, userId));
}

/** 실시간 연결의 "볼 수 있나"(보낼 때 동기로). 멤버 캐시를 보되, 쓸 수 없는 서버는 캐시를 믿지 않는다 */
function seesGuild(guild: { available?: boolean; members: { cache: { has(id: string): boolean } } } | undefined, userId: string) {
  return Boolean(guild && guild.available !== false && guild.members.cache.has(userId));
}

/** 이 요청으로 서버 하나를 연다. 못 열면 응답을 쓰고 null(멤버가 아니면 no-guild-access) */
async function openGuild<P>(req: Request<P>, res: Response, guildId: string) {
  const { bot } = req.app.locals;
  const { client } = bot;
  if (!client.isReady()) {
    sendProblem(res, "bot-not-ready");
    return null;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    sendProblem(res, "guild-not-found");
    return null;
  }

  // 조회 인가는 세션의 굳은 서버 목록이 아니라 실멤버십으로 판정 (추방 즉시 차단). member는 후속 권한 계산에 재사용.
  const userId = signedIn(req).id;
  const fetched = await memberOf(guild, userId);
  if (!fetched) {
    sendProblem(res, "no-guild-access");
    return null;
  }

  // 권한 수준 오버라이드가 걸려 있으면 여기서 대역 멤버로 바꾼다. 이 한 곳이면 아래의
  // checkControl/checkAdd/isModerator가 전부 그 계층으로 판정된다.
  const member = shadowMember(req, fetched);
  // 재생 조작을 하는 사람
  const actor: Actor = { member };
  return { bot, guild, player: bot.players.get(guildId) ?? null, member, actor };
}

// 음성 재적 상태. 채널 단위로 본다. "봇과 같은 채널인가"가 조작 가능 여부(checkVoice)의 기준이고,
// botInVoice/userInVoice를 따로 보면 같은 서버 다른 채널을 구분하지 못한다.
function voiceFlags(guild: Guild | null | undefined, userId: string | null | undefined) {
  // channelId가 아니라 channel?.id로 읽는다. permissions.ts의 checkVoice와 같은 경로여야
  // 채널이 캐시에 없을 때 "화면은 조작 가능이라는데 서버는 막는" 어긋남이 생기지 않는다.
  //
  // 멤버가 아니라 voiceStates에서 읽는 이유: 멤버 캐시는 비어 있을 수 있지만 음성 상태는
  // 게이트웨이가 항상 채워둔다(GUILD_CREATE + VOICE_STATE_UPDATE). member.voice도 결국 이걸 본다.
  const botChannelId = guild?.members?.me?.voice?.channel?.id ?? null;
  const userChannelId = (userId && guild?.voiceStates?.cache?.get(userId)?.channel?.id) || null;
  return { botInVoice: !!botChannelId, userInVoice: !!userChannelId, sameVoice: !!botChannelId && botChannelId === userChannelId };
}

export { openGuild, voiceFlags, notMember, memberOf, seesGuild };
