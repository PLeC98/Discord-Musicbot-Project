"use strict";

const { RESTJSONErrorCodes } = require("discord.js");
const log = require("./logger").child({ category: "session" });

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
 *   실패는 거짓 — 세션을 지우지 않고 다음 기동에서 다시 시도한다.
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

  log.warn(`서버 ${guildId} 조회에 ${attempts}회 실패 — 세션을 보존한 채 건너뜁니다: ${lastError?.message ?? "길드를 받지 못함"}`);
  return { guild: null, gone: false };
}

module.exports = { resolveGuildForRestore, ATTEMPTS, RETRY_DELAY_MS };
