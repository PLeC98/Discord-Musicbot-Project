'use strict';

const { PermissionFlagsBits } = require('discord.js');
const GuildSettingsManager = require('./GuildSettingsManager');
const S = require('./strings');

// "강한 모더레이션 권한" — 이 중 하나라도 있으면 관리자 계층(상위)으로 취급.
// 서버 소유자와 Administrator 권한자는 discord.js 권한 검사가 자동으로 전부 통과시킨다.
// 기준을 조정하려면 이 배열만 수정하면 된다.
const MOD_PERMISSIONS = [
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ModerateMembers,
];

function isModerator(member) {
    return MOD_PERMISSIONS.some((perm) => member.permissions.has(perm));
}

/**
 * DJ 계층 이상인가 — 재생 조작 권한의 기준.
 *  - 모더레이터: 항상 DJ 취급
 *  - DJ 역할이 설정된 길드(/setdjrole, 복수 가능): 그 중 하나라도 보유한 유저만
 *  - 미설정 길드: 전원 DJ (DJ 역할 설정은 opt-in 제한)
 *  - 설정된 역할이 서버에서 전부 삭제된 경우: 전원 잠금 사고를 막기 위해 미설정과 동일 취급
 */
async function isDj(member) {
    if (isModerator(member)) return true;

    const djRoleIds = await GuildSettingsManager.getDjRoles(member.guild.id);
    if (!djRoleIds.length) return true;

    const validIds = djRoleIds.filter((id) => member.guild.roles.cache.has(id));
    if (!validIds.length) return true;

    return validIds.some((id) => member.roles.cache.has(id));
}

/**
 * 재적 규칙 — 관리자는 어디서든 면제, 그 외는:
 *  - 봇이 음성 채널에서 동작 중이면 같은 채널 재적 필수
 *  - 봇이 유휴(음성 미접속)면 채널 제약 없음
 * 통과 시 null, 거부 시 사용자에게 보여줄 오류 문자열 반환.
 */
function checkVoice(member) {
    if (isModerator(member)) return null;

    const botChannelId = member.guild.members.me?.voice?.channel?.id;
    if (!botChannelId) return null;
    if (member.voice.channel?.id === botChannelId) return null;

    return member.voice.channel ? S.ERR_SAME_CHANNEL : S.ERR_VOICE_REQUIRED;
}

/** 모든 재생 조작(🔒)의 단일 기준: 재적 규칙 + DJ 계층 */
async function checkControl(member) {
    const voiceErr = checkVoice(member);
    if (voiceErr) return voiceErr;

    if (!(await isDj(member))) return S.ERR_NOT_AUTHORIZED;
    return null;
}

/** 곡 추가(일반 추가): 계층 무관 전원 가능, 재적 규칙만 적용 (우선 추가는 checkControl 사용) */
function checkAdd(member) {
    return checkVoice(member);
}

/** 스킵: DJ 계층이거나, 현재 곡의 요청자 본인 (요청자도 재적 규칙은 적용) */
async function checkSkip(member, player) {
    const controlErr = await checkControl(member);
    if (!controlErr) return null;

    const requesterId = player?.currentTrack?.requestedBy?.id;
    if (requesterId && requesterId === member.id) return checkVoice(member);

    return controlErr;
}

/** 대기열 곡 제거: DJ 계층이거나, 그 곡의 요청자 본인 (요청자도 재적 규칙은 적용) */
async function checkRemoveTrack(member, track) {
    const controlErr = await checkControl(member);
    if (!controlErr) return null;

    const requesterId = track?.requestedBy?.id;
    if (requesterId && requesterId === member.id) return checkVoice(member);

    return controlErr;
}

module.exports = { MOD_PERMISSIONS, isModerator, isDj, checkVoice, checkControl, checkAdd, checkSkip, checkRemoveTrack };
