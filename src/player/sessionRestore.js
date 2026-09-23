"use strict";

const { RESTJSONErrorCodes } = require("discord.js");
const log = require("../infra/log/logger").child({ category: "session" });
const { sessions } = require("../store/playerSessions");

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// 봇이 그 길드에 더 이상 없다는 디스코드의 확답. 이 경우에만 저장 세션을 버린다.
const GONE_CODES = new Set([RESTJSONErrorCodes.UnknownGuild, RESTJSONErrorCodes.MissingAccess]);

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * 저장 세션을 복원할 길드를 확보한다. 부팅 직후에는 캐시가 덜 차 있을 수 있어 REST로 재시도한다.
 *
 * @returns {Promise<{guild: object|null, gone: boolean}>}
 *   `gone`은 길드가 실제로 사라졌을 때만 참이다. 네트워크 오류·5xx·레이트리밋 같은 일시적
 *   실패는 거짓. 세션을 지우지 않고 다음 기동에서 다시 시도한다.
 */
async function resolveGuildForRestore(client, guildId, { attempts = ATTEMPTS, delayMs = RETRY_DELAY_MS } = {}) {
  const cached = client.guilds.cache.get(guildId);
  if (cached) return { guild: cached, gone: false };

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(delayMs);
    try {
      const guild = await client.guilds.fetch(guildId);
      if (guild) return { guild, gone: false };
    } catch (error) {
      if (GONE_CODES.has(error?.code)) return { guild: null, gone: true };
      lastError = error;
    }
  }

  log.warn(`서버 ID ${guildId} 조회를 ${attempts}회 실패. 세션을 지우지 않고 다음 기동에서 다시 시도합니다: ${lastError?.message ?? "길드를 받지 못함"}`);
  return { guild: null, gone: false };
}

// 기동 때 저장된 재생 세션을 모두 되살린다. 플레이어는 부르는 쪽이 준 것으로 만든다
async function restoreSavedPlayers(client, MusicPlayer) {
  const saved = sessions().loadAll();
  if (saved.length === 0) return;

  log.info(`저장된 재생 세션 ${saved.length}개를 복원합니다`);

  for (const record of saved) {
    const { guildId } = record;
    try {
      const { guild, gone } = await resolveGuildForRestore(client, guildId);

      if (!guild) {
        // 일시적 조회 실패면 세션을 남긴다. 다음 기동에서 다시 시도한다
        if (gone) {
          log.warn(`서버 ID ${guildId}을(를) 찾을 수 없거나 접근할 수 없어 저장된 세션을 제거합니다.`);
          sessions().removeSession(guildId);
        }
        continue;
      }

      const { voiceChannelId, textChannelId } = record.session;

      if (!voiceChannelId || !textChannelId) {
        sessions().removeSession(guildId);
        continue;
      }

      let voiceChannel = guild.channels.cache.get(voiceChannelId) || null;
      if (!voiceChannel) {
        voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
      }

      let textChannel = guild.channels.cache.get(textChannelId) || null;
      if (!textChannel) {
        textChannel = await guild.channels.fetch(textChannelId).catch(() => null);
      }

      const isVoiceValid = voiceChannel && typeof voiceChannel.isVoiceBased === "function" && voiceChannel.isVoiceBased();
      const isTextValid = textChannel && typeof textChannel.isTextBased === "function" && textChannel.isTextBased();

      if (!isVoiceValid || !isTextValid) {
        log.warn(`서버 ${guild.name}의 채널 정보가 유효하지 않아 저장된 세션을 제거합니다.`);
        sessions().removeSession(guildId);
        continue;
      }

      const player = new MusicPlayer(guild, textChannel, voiceChannel);
      client.players.set(guildId, player);

      try {
        await player.restoreFromState(record);
        log.info(`서버 ${guild.name}의 세션 복원 완료`);
      } catch (error) {
        log.error(`서버 ${guild.name} (${guildId}) 세션 복원 중 오류:`, error.message);
        client.players.delete(guildId);
        player.cleanup("세션 복원 실패");
        sessions().removeSession(guildId);
      }
    } catch (error) {
      log.error(`서버 ID ${guildId} 세션 복원 중 오류:`, error.message);
      sessions().removeSession(guildId);
    }
  }
}

module.exports = { resolveGuildForRestore, restoreSavedPlayers, ATTEMPTS, RETRY_DELAY_MS };
