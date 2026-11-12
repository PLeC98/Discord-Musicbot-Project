import { PermissionFlagsBits } from "discord.js";
import config from "../config/index.ts";
import * as GuildSettingsManager from "../store/guild-settings.ts";
import type { Code } from "../rules/problems.ts";
import type { GuildMember } from "discord.js";
import type { QueuedTrack } from "../player/track.ts";
import { ownTrackDenied } from "../rules/controls.ts";

/** 권한 판정이 막은 까닭 */
type PermissionDenied = Extract<Code, "must-be-in-voice" | "must-be-in-same-voice" | "must-dj" | "permission-voice">;

/**
 * 서버 관리자(상위 계층)인가: 서버 관리 권한. 설정 화면 버튼, 대시보드 서버 설정, 재생 조작의 면제(늘 DJ, 동일 음성 채널 규칙 면제)가 이것을 본다.
 * 설정 명령은 같은 권한을 디스코드 기본 권한(default_member_permissions)으로 걸고, 서버 관리자가 연동 탭에서 다른 역할에 열어 줄 수 있으므로 명령 실행 진입점(events/interaction-create)에서 다시 확인한다.
 * 서버 소유자와 Administrator는 discord.js 권한 검사가 통과시킨다. 봇 운영자(OWNER_ID, 아래 isBotOwner)와는 다르다.
 */
function isServerManager(member: GuildMember) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

/** 봇 운영자(OWNER_ID)인지 확인한다. 디스코드 권한으로는 나타낼 수 없다. OWNER_ID가 비어 있으면 아무도 아니다 */
function isBotOwner(userId: string) {
  const ownerId = config.dashboard.ownerId;
  return !!ownerId && userId === ownerId;
}

/**
 * DJ 계층 이상인가. 재생 조작 권한의 기준.
 *  - 서버 관리자: 항상 DJ 취급
 *  - DJ 역할이 설정된 서버(/setting, 대시보드 서버 설정, 복수 가능): 그 중 하나라도 보유한 유저만
 *  - 미설정 서버: 전원 DJ (DJ 역할 설정은 opt-in 제한)
 *  - 설정된 역할이 서버에서 전부 삭제된 경우: 전원 잠금 사고를 막기 위해 미설정과 동일 취급
 */
async function isDj(member: GuildMember) {
  if (isServerManager(member)) return true;

  const djRoleIds = await GuildSettingsManager.getDjRoles(member.guild.id);
  if (!djRoleIds.length) return true;

  const validIds = djRoleIds.filter((id) => member.guild.roles.cache.has(id));
  if (!validIds.length) return true;

  return validIds.some((id) => member.roles.cache.has(id));
}

/**
 * 동일 음성 채널 규칙. 서버 관리자는 어디서든 면제, 그 외는:
 *  - 봇이 음성 채널에서 동작 중이면 같은 채널 접속 필수(음성 채널 밖이든 다른 채널이든 같은 까닭)
 *  - 봇이 유휴(음성 미접속)면 채널 제약 없음. 봇을 부를 때의 음성 채널 접속은 checkSummon 이 본다
 * 통과 시 null, 거부 시 그 까닭.
 */
function checkVoice(member: GuildMember): PermissionDenied | null {
  if (isServerManager(member)) return null;

  const botChannelId = member.guild.members.me?.voice?.channel?.id;
  if (!botChannelId) return null;
  if (member.voice.channel?.id === botChannelId) return null;

  return "must-be-in-same-voice";
}

/** 모든 재생 조작(🔒)의 단일 기준: 동일 음성 채널 규칙 + DJ 계층 */
async function checkControl(member: GuildMember): Promise<PermissionDenied | null> {
  const voiceErr = checkVoice(member);
  if (voiceErr) return voiceErr;

  if (!(await isDj(member))) return "must-dj";
  return null;
}

/** 곡 추가(일반 추가): 계층과 무관하게 누구나 가능하며, 동일 음성 채널 규칙만 적용한다(우선 추가는 checkAddFirst) */
function checkAdd(member: GuildMember) {
  return checkVoice(member);
}

/** 우선 추가(대기열 맨 앞): 재생 순서를 바꾸는 조작이라 DJ 계층이어야 한다. 봇이 유휴 상태면 부를 수 있는지도 본다. /playfirst와 그 더 넣기 메뉴가 같이 쓴다 */
async function checkAddFirst(member: GuildMember): Promise<PermissionDenied | null> {
  return (await checkControl(member)) || checkSummon(member);
}

/**
 * 봇이 유휴 상태일 때 소환할 수 있는지 확인한다. 요청자의 채널로 들어가야 하므로 서버 관리자여도 본인이 접속해 있어야 하며,
 * 봇에게 그 채널의 Connect/Speak 권한이 있어야 한다. 봇이 이미 음성 채널에 있으면 검사 불필요(null).
 *
 * 동일 음성 채널 규칙(checkVoice)은 봇 유휴 시 항상 통과시키므로, 곡 추가 진입점은 checkAdd/checkControl에
 * 이 검사를 이어 붙여야 두 상태가 모두 덮인다.
 */
function checkSummon(member: GuildMember): PermissionDenied | null {
  const me = member.guild.members.me;
  if (me?.voice?.channel) return null;

  const target = member.voice.channel;
  if (!target) return "must-be-in-voice";

  const permissions = me ? target.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
    return "permission-voice";
  }
  return null;
}

/** 그 곡을 넣은 사람도 하는 조작: DJ 계층이거나, 그 곡의 요청자 본인 (요청자도 동일 음성 채널 규칙은 적용. rules/controls) */
async function checkOwnTrack(member: GuildMember, track: Pick<QueuedTrack, "requestedBy"> | null | undefined) {
  const requesterId = track?.requestedBy?.id;
  return ownTrackDenied({ control: await checkControl(member), requester: Boolean(requesterId) && requesterId === member.id, voice: () => checkVoice(member) });
}

/** 스킵: 지금 곡을 넣은 사람도 된다 */
const checkSkip = (member: GuildMember, player: { currentTrack?: Pick<QueuedTrack, "requestedBy"> | null } | null | undefined) => checkOwnTrack(member, player?.currentTrack);

/** 대기열 곡 제거: 그 곡을 넣은 사람도 된다 */
const checkRemoveTrack = checkOwnTrack;

/**
 * 디스코드에서 봇을 추방할 수 있는 사람인가: 멤버 추방 권한(관리자 포함)이 있고, 서버 소유자이거나 가장 높은 역할이 봇의 가장 높은 역할보다 위(디스코드의 역할 순서 규칙).
 * 타임아웃 중이면 디스코드가 권한을 거두므로 아니다(소유자, 관리자는 그대로). 봇의 역할 가운데 캐시에 없는 것이 있으면 봇의 높이를 알 수 없어 아니다.
 * 대시보드 서버 설정의 봇 내보내기가 본다
 */
function canKickBot(member: GuildMember) {
  const owner = member.guild.ownerId === member.id;
  if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return false;
  if (!owner && member.isCommunicationDisabled() && !member.permissions.has(PermissionFlagsBits.Administrator)) return false;
  if (owner) return true;
  const me = member.guild.members.me;
  // 역할 id 목록은 discord.js 가 캐시에 없는 역할을 빼고 roles 로 보여 주기 전의 원본이다
  if (!me || me["_roles"].some((id) => !member.guild.roles.cache.has(id))) return false;
  return member.roles.highest.comparePositionTo(me.roles.highest) > 0;
}

export { isServerManager, isBotOwner, isDj, canKickBot, checkVoice, checkControl, checkAdd, checkAddFirst, checkSummon, checkSkip, checkRemoveTrack };
export type { PermissionDenied };
