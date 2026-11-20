import os from "node:os";
import { RESTJSONErrorCodes, type Client, type Guild } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "session" });
import { sessions, type SessionState } from "../store/player-sessions.ts";
import { codeOf, describeError, messageOf } from "../rules/error-kind.ts";
import { inGuild } from "../infra/guild-context.ts";
import { isShuttingDown } from "../infra/shutdown-state.ts";
import { mapLimit } from "../infra/map-limit.ts";
import { ytdlpLoad } from "../sources/ytdlp-spawn.ts";
import type { Player } from "./player.ts";
import type { PlayerSeats } from "./registry.ts";

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// 봇이 그 길드에 더 이상 없다는 디스코드의 확답. 이 경우에만 저장 세션을 버린다.
const GONE_CODES = new Set<unknown>([RESTJSONErrorCodes.UnknownGuild, RESTJSONErrorCodes.MissingAccess]);

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * 저장 세션을 복원할 길드를 확보한다. 봇이 속한 길드는 READY 때 모두 캐시에 들어오므로(정보를 아직 못 받은 길드도 빈 항목으로),
 * 캐시에 없으면 REST로 확인하고 일시적인 오류일 때만 몇 번 더 시도한다.
 *
 * `gone`은 길드가 실제로 사라졌을 때만 참이다. 네트워크 오류, 5xx, 레이트리밋 같은 일시적
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

  log.warn(`서버 ID ${guildId} 조회 ${attempts}회 실패(세션을 유지하고 다음 기동 시 재시도): ${lastError ? messageOf(lastError) : "길드를 불러오지 못함"}`);
  return { guild: null, gone: false };
}

// 플레이어는 호출부가 준 생성자로 만든다(player.ts를 불러오지 않게)
type PlayerClass = typeof Player;
/** 서버마다의 플레이어. 복원한 플레이어를 여기에 올린다(복원하는 동안 들어온 명령이 같은 플레이어를 보게 먼저 올린다) */
type Registry = Pick<PlayerSeats, "has" | "set">;

/**
 * 기동 시 저장된 재생 세션을 복원한다. /join으로만 이어 듣게 남긴 세션(/leave, 혼자 남아 나감)은 두고 붙지 않는다.
 * skip: 이번 기동은 복원하지 않는다(짧게 끊긴 실행이 이어졌다, app/run-record). 세션은 남긴다.
 * cpus: 이 프로세스가 쓸 수 있는 CPU 수. 동시에 복원할 서버 수를 정하는 데 쓴다
 * 돌려주는 것: 복원을 시도한 서버 ID(복원했든 못 했든, 건너뛰면 없음). 이어받기(voiceAdopt)가 이 서버들은 건드리지 않는다
 */
async function restoreSessions(client: Client, players: Registry, PlayerCtor: PlayerClass, { skip = false, cpus = os.availableParallelism() }: { skip?: boolean; cpus?: number } = {}) {
  const all = sessions().loadAll();
  const saved = all.filter((s) => s.session.autoResume !== false);
  const forJoin = all.length - saved.length;
  if (forJoin > 0) log.info(`/join으로만 이어 듣는 세션 ${forJoin}개는 기동 때 복원하지 않음`);
  const touched = saved.map((s) => s.guildId);
  if (saved.length === 0) return touched;
  if (skip) {
    log.warn(`짧은 간격의 비정상 종료가 반복되어 저장된 세션 ${saved.length}개의 복원을 건너뜀(세션은 유지): 서버 ID ${touched.join(", ")}`);
    // 손대지 않았다. 음성에 남은 봇은 이어받기가 뺀다
    return [];
  }

  log.info(`저장된 재생 세션 ${saved.length}개 복원 시작`);

  // 차례를 기다리는 서버로 올려 둔다. 그사이 곡 추가, 자동재생 켜기, /join이 오면 그 서버를 먼저 복원한다(waitForRestore)
  for (const { guildId } of saved) {
    waiting.set(guildId, async () => {
      try {
        // 서버 문맥으로: 복원한 재생이 여는 작업(연령 제한 판정, 자식 프로세스 기록)이 그 서버의 작업으로 돈다
        await inGuild(guildId, () => restoreOne(client, players, PlayerCtor, guildId));
      } catch (error) {
        // 지우지 않는다. 다음 기동, /join이 재시도한다(지운 대기열은 되찾을 수 없다)
        log.error(`서버 ID ${guildId} 세션 복원 중 오류(세션은 남김):`, messageOf(error));
      }
    });
  }
  // 몇 곳씩 동시에 복원한다. 먼저 복원 중인 서버 차례가 오면 슬롯을 쥔 채 그 복원이 끝나기를 기다린다(동시에 도는 복원 수가 늘지 않게)
  await mapLimit(touched, restoreAtOnce(ytdlpLoad().lookup.size, cpus), async (guildId) => restoreNow(guildId));
  return touched;
}

// 기동 복원을 동시에 돌릴 서버 수. 복원도 곡을 열 때 사람의 곡 찾기와 같은 yt-dlp 줄에 같은 순위로 선다.
// 줄의 슬롯 수보다 하나 적게 돌려, 그사이 다른 서버에서 곡을 찾는 사람이 빈 슬롯을 바로 얻게 한다.
// CPU 수보다 많이는 돌리지 않는다. yt-dlp가 한꺼번에 CPU 수보다 많이 뜨면 다른 서버의 곡 찾기가 느려진다
const restoreAtOnce = (lookupSlots: number, cpus: number) => Math.max(1, Math.min(RESTORE_AT_ONCE_MAX, lookupSlots - 1, cpus));
// 슬롯과 CPU가 넉넉해도 이보다 많이는 돌리지 않는다. 이보다 많이 돌리면 이미 재생 중인 서버의 소리가 잠깐 끊길 수 있다
const RESTORE_AT_ONCE_MAX = 3;

// 기동 복원의 차례를 기다리는 서버, 지금 복원 중인 서버. 같은 서버를 두 번 복원하지 않는다
const waiting = new Map<string, () => Promise<void>>();
const restoring = new Map<string, Promise<void>>();

function restoreNow(guildId: string): Promise<void> | null {
  const running = restoring.get(guildId);
  if (running) return running;
  const start = waiting.get(guildId);
  if (!start) return null;
  waiting.delete(guildId);
  const run = start().finally(() => restoring.delete(guildId));
  restoring.set(guildId, run);
  return run;
}

/**
 * 기동 복원이 아직 이 서버에 오지 않았으면 지금 복원하고 끝날 때까지 기다린다.
 * 플레이어를 새로 만드는 쪽(곡 추가, 자동재생 켜기, /join)이 먼저 부른다. 그러지 않으면 곧 복원될 세션을 새 플레이어가 지운다(타이밍 탓)
 */
async function waitForRestore(guildId: string) {
  await restoreNow(guildId);
}

// 복원 직전에 그 서버의 세션을 다시 읽는다. 기동 때 읽은 목록을 쓰면 그사이 지워진 세션을 옛 기록으로 되살린다
async function restoreOne(client: Client, players: Registry, PlayerCtor: PlayerClass, guildId: string) {
  const record = sessions().load(guildId);
  if (!record) return;
  const { guild, gone } = await resolveGuildForRestore(client, guildId);
  if (!guild) {
    // 일시적 조회 실패면 세션을 남긴다. 다음 기동에서 다시 시도한다
    if (gone) {
      log.warn(`서버를 찾을 수 없거나 접근할 수 없어 저장된 세션 삭제: 서버 ID ${guildId}`);
      sessions().removeSession(guildId);
    }
    return;
  }

  // 기다리는 사이 사람이 이 서버에서 재생을 시작했으면 그쪽이 이긴다. 세션 기록도 이미 그 플레이어가 쓰고 있어 건드리지 않는다
  const alreadyPlaying = () => {
    if (!players.has(guildId)) return false;
    log.info(`서버 ${guild.name}에서 이미 재생 중이라 저장 세션 복원을 건너뜀`);
    return true;
  };
  if (alreadyPlaying()) return;

  const channels = await savedChannels(guild, record.session);
  // 종료가 시작됐으면 플레이어를 만들지 않는다(세션은 남긴다)
  if (alreadyPlaying() || isShuttingDown()) return;
  if (channels === "gone") {
    sessions().removeSession(guildId);
    return;
  }
  // 채널을 잠깐 못 불러왔다(네트워크, 5xx, 요청 제한). 다음 기동, /join이 재시도한다
  if (channels === "unknown") return;

  const player = new PlayerCtor(guild, channels.text, channels.voice);
  players.set(guildId, player);
  try {
    const outcome = await player.persistence.restoreSession(record);
    log.info(`서버 ${guild.name}의 세션 복원: ${RESTORE_OUTCOME[outcome]}`);
  } catch (error) {
    // 음성 연결 실패 등. 세션은 남긴다(다음 기동, /join이 재시도한다). 종료 중이라 붙지 않은 것은 실패가 아니다
    if (codeOf(error) === "bot-shutting-down") log.info(`서버 ${guild.name}의 세션 복원 중단: 종료 중(세션은 남김)`);
    else log.error(`서버 ${guild.name} (${guildId}) 세션 복원 중 오류(세션은 남김):`, messageOf(error));
    await player.dispose({ reason: "세션 복원 실패", session: "keep", end: "restore-failed" });
  }
}

// 복원한 결과를 로그에
const RESTORE_OUTCOME = { restored: "이어 재생", parked: "열지 못해 그 곡에서 일시정지해 둠", failed: "재생할 곡을 열지 못함", empty: "재생할 곡 없음" } as const;

// 채널이 없다는 디스코드의 확답(삭제됨, 볼 수 없음). 그 밖의 조회 실패는 잠깐일 수 있다
const CHANNEL_GONE = new Set<unknown>([RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.MissingAccess]);
// 조회 실패의 답: gone은 없다는 확답, unknown은 알 수 없음(잠깐의 실패)
const lookupFailed = Symbol("lookup-failed");

/**
 * 저장된 음성, 텍스트 채널. gone: 음성 채널 기록이 없거나 없다는 확답이거나 음성 채널이 아니다(세션을 지운다), unknown: 잠깐 못 불러왔다(세션을 남긴다).
 * 텍스트 채널은 없어도 된다(전용 채널 없이 대시보드로 시작한 세션은 텍스트 채널 없이 저장된다. 패널은 서버의 전용 채널로 간다)
 */
async function savedChannels(guild: Guild, { voiceChannelId, textChannelId }: SessionState) {
  if (!voiceChannelId) return "gone" as const;
  const fetch = (id: string) =>
    guild.channels.fetch(id).catch((error: unknown) => {
      if (CHANNEL_GONE.has(codeOf(error))) return null;
      log.warn(`서버 ${guild.name}의 채널 ${id} 조회 실패(세션은 남김): ${describeError(error)}`);
      return lookupFailed;
    });
  const find = async (id: string) => guild.channels.cache.get(id) || (await fetch(id));
  const voice = await find(voiceChannelId);
  const text = textChannelId ? await find(textChannelId) : null;
  if (voice === lookupFailed || text === lookupFailed) return "unknown" as const;
  if (!voice?.isVoiceBased()) {
    log.warn(`서버 ${guild.name}의 저장된 음성 채널이 없어 저장된 세션 삭제`);
    return "gone" as const;
  }
  return { voice, text: text?.isTextBased() ? text : null };
}

/** 서버 하나의 저장된 세션을 복원한다(서버 하나 다시 시작). 세션이 없으면 아무것도 안 한다 */
async function restoreGuild(client: Client, players: Registry, PlayerCtor: PlayerClass, guildId: string) {
  await inGuild(guildId, () => restoreOne(client, players, PlayerCtor, guildId));
}

export { resolveGuildForRestore, restoreSessions, restoreGuild, waitForRestore, ATTEMPTS, RETRY_DELAY_MS };
