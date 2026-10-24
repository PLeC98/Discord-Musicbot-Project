import { RESTJSONErrorCodes, type Client, type Guild } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "session" });
import { sessions, type RestoredSession, type SessionState } from "../store/player-sessions.ts";
import { codeOf, describeError, messageOf } from "../rules/error-kind.ts";
import { inGuild } from "../infra/guild-context.ts";
import type { Player } from "./player.ts";
import type { PlayerSeats } from "./registry.ts";

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// 봇이 그 길드에 더 이상 없다는 디스코드의 확답. 이 경우에만 저장 세션을 버린다.
const GONE_CODES = new Set<unknown>([RESTJSONErrorCodes.UnknownGuild, RESTJSONErrorCodes.MissingAccess]);

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * 저장 세션을 복원할 길드를 확보한다. 기동 직후에는 캐시가 덜 차 있을 수 있어 REST로 재시도한다.
 *
 * `gone`은 길드가 실제로 사라졌을 때만 참이다. 네트워크 오류·5xx·레이트리밋 같은 일시적
 *   실패는 거짓. 세션을 삭제하지 않고 다음 기동에서 다시 시도한다.
 */
async function resolveGuildForRestore(client: Client, guildId: string, { attempts = ATTEMPTS, delayMs = RETRY_DELAY_MS } = {}): Promise<{ guild: Guild | null; gone: boolean }> {
  const cached = client.guilds.cache.get(guildId);
  if (cached) return { guild: cached, gone: false };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(delayMs);
    try {
      const guild = await client.guilds.fetch(guildId);
      if (guild) return { guild, gone: false };
    } catch (error) {
      if (GONE_CODES.has(codeOf(error))) return { guild: null, gone: true };
      lastError = error;
    }
  }

  log.warn(`서버 ID ${guildId} 조회를 ${attempts}회 실패. 세션을 삭제하지 않고 다음 기동에서 다시 시도합니다: ${lastError ? messageOf(lastError) : "길드를 불러오지 못함"}`);
  return { guild: null, gone: false };
}

// 기동 때 저장된 재생 세션을 모두 복원한다. 플레이어는 부르는 쪽이 준 생성자로 만든다(이 폴더의 중심 파일을 부르지 않게)
type PlayerClass = typeof Player;
/** 서버마다의 플레이어. 복원한 플레이어를 여기에 올린다(복원하는 동안 들어온 명령이 같은 플레이어를 보게 먼저 올린다) */
type Registry = Pick<PlayerSeats, "has" | "set">;

/**
 * skip: 이번 기동은 복원하지 않는다(짧게 끊긴 실행이 연달아였다, app/run-record). 세션은 남긴다.
 * 돌려주는 것: 저장된 세션이 있던 서버 ID(복원했든 못 했든). 이어받기(voiceAdopt)가 이 서버들은 건드리지 않는다
 */
async function restoreSavedPlayers(client: Client, players: Registry, PlayerCtor: PlayerClass, { skip = false }: { skip?: boolean } = {}) {
  const saved = sessions().loadAll();
  const touched = saved.map((s) => s.guildId);
  if (saved.length === 0) return touched;
  if (skip) {
    log.warn(`짧게 끊긴 실행이 연달아여서 이번에는 저장된 세션 ${saved.length}개를 복원하지 않습니다(세션은 남겨 둡니다): 서버 ID ${touched.join(", ")}`);
    return touched;
  }

  log.info(`저장된 재생 세션 ${saved.length}개를 복원합니다`);

  for (const record of saved) {
    try {
      // 서버 문맥으로: 복원한 재생이 여는 일(연령 제한 판정 · 자식 프로세스 기록)이 그 서버의 일로 돈다
      await inGuild(record.guildId, () => restoreOne(client, players, PlayerCtor, record));
    } catch (error) {
      log.error(`서버 ID ${record.guildId} 세션 복원 중 오류:`, messageOf(error));
      sessions().removeSession(record.guildId);
    }
  }
  return touched;
}

async function restoreOne(client: Client, players: Registry, PlayerCtor: PlayerClass, record: RestoredSession) {
  const { guildId } = record;
  const { guild, gone } = await resolveGuildForRestore(client, guildId);
  if (!guild) {
    // 일시적 조회 실패면 세션을 남긴다. 다음 기동에서 다시 시도한다
    if (gone) {
      log.warn(`서버 ID ${guildId}을(를) 찾을 수 없거나 접근할 수 없어 저장된 세션을 제거합니다.`);
      sessions().removeSession(guildId);
    }
    return;
  }

  // 기다리는 사이 사람이 이 서버에서 재생을 시작했으면 그쪽이 이긴다. 세션 기록도 이미 그 플레이어가 쓰고 있어 건드리지 않는다
  const alreadyPlaying = () => {
    if (!players.has(guildId)) return false;
    log.info(`서버 ${guild.name}은(는) 이미 재생 중이라 저장 세션 복원을 건너뜁니다`);
    return true;
  };
  if (alreadyPlaying()) return;

  const channels = await savedChannels(guild, record.session);
  if (alreadyPlaying()) return;
  if (!channels) {
    sessions().removeSession(guildId);
    return;
  }

  const player = new PlayerCtor(guild, channels.text, channels.voice);
  players.set(guildId, player);
  try {
    const outcome = await player.persistence.restoreFromState(record);
    log.info(`서버 ${guild.name}의 세션 복원: ${RESTORE_OUTCOME[outcome]}`);
  } catch (error) {
    log.error(`서버 ${guild.name} (${guildId}) 세션 복원 중 오류:`, messageOf(error));
    await player.dispose({ reason: "세션 복원 실패", session: "remove" });
  }
}

// 복원한 결과를 로그에
const RESTORE_OUTCOME = { restored: "이어 틂", failed: "틀 곡을 열지 못함", empty: "틀 곡 없음" } as const;

// 저장된 음성 · 텍스트 채널. 기록이 없거나 그 종류의 채널이 아니면 null
async function savedChannels(guild: Guild, { voiceChannelId, textChannelId }: SessionState) {
  if (!voiceChannelId || !textChannelId) return null;
  const fetch = (id: string) =>
    guild.channels.fetch(id).catch((error: unknown) => {
      // 채널이 삭제됐다(10003)는 답은 없다는 뜻이다. 그 밖의 실패도 세션을 제거하게 되므로 까닭을 남긴다
      if (codeOf(error) !== RESTJSONErrorCodes.UnknownChannel) log.warn(`서버 ${guild.name}의 채널 ${id} 조회 실패: ${describeError(error)}`);
      return null;
    });
  const find = async (id: string) => guild.channels.cache.get(id) || (await fetch(id));
  const voice = await find(voiceChannelId);
  const text = await find(textChannelId);
  if (voice?.isVoiceBased() && text?.isTextBased()) return { voice, text };
  log.warn(`서버 ${guild.name}의 채널 정보가 유효하지 않아 저장된 세션을 제거합니다.`);
  return null;
}

/** 서버 하나의 저장된 세션을 복원한다(서버 하나 다시 시작). 세션이 없으면 아무것도 안 한다 */
async function restoreGuild(client: Client, players: Registry, PlayerCtor: PlayerClass, guildId: string) {
  const record = sessions().load(guildId);
  if (record) await inGuild(guildId, () => restoreOne(client, players, PlayerCtor, record));
}

export { resolveGuildForRestore, restoreSavedPlayers, restoreGuild, ATTEMPTS, RETRY_DELAY_MS };
