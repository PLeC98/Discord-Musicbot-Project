// 프로세스 레벨 오류 복원력. 기동이 installErrorHandlers 로 처리기를 건다.
//
// 방침: 일시적 네트워크 오류는 프로세스를 살린 채 "영향받은 서버만" 표적 복구하고,
//       진짜 치명적 오류는 안전하게 종료해 봇 운영자의 확인·수동 재시작을 대기.

import logger from "../infra/log/logger.ts";
import { VoiceConnectionStatus } from "@discordjs/voice";
import { Events } from "discord.js";
import { isDeadInteraction } from "../rules/deadInteraction.ts";
import { codeOf, messageOf } from "../rules/errorKind.ts";
import { bestEffort } from "../infra/bestEffort.ts";
const log = logger.child({ category: "voice" }); // 표적 복구는 음성 연결의 일이다
// 프로세스를 내리는 것은 음성 관심사가 아니다. 로그를 카테고리로 거를 때 엉뚱한 칸에 들어간다.
const flog = logger.child({ category: "core", sub: "fatal" });
// 새어 나온 오류 처리기의 로그. 봇 전체의 일이다
const coreLog = logger.child({ category: "core" });

/** 표적 복구로 볼 플레이어. 여기서 읽고 부르는 칸만 */
type Healable = { currentTrack: unknown; paused: boolean; isRecovering?: boolean; connection?: { state?: { status?: string } } | null; voice: { startConnectionRecovery(): unknown } };
/** 치명적 오류로 내릴 플레이어 */
type Cleanable = { cleanup?(reason: string): unknown };
/** 플레이어 레지스트리에서 쓰는 것 */
type HealClient = { players?: Iterable<readonly [string, Healable | null]> };
type FatalClient = { players?: Pick<Map<string, Cleanable | null>, "forEach" | "clear"> };
/** 오류 처리기를 걸 클라이언트 */
type WatchedClient = HealClient & FatalClient & { on(event: "error", listener: (error: Error) => void): unknown };
/** 처리되지 않은 거부 · 예외를 알리는 곳(프로세스) */
type Proc = { on(event: "unhandledRejection" | "uncaughtException", listener: (error: unknown) => void): unknown };

// 네트워크 오류 폭주 판정용 시간창
const NET_ERR_WINDOW_MS = 60000;
const NET_ERR_MAX = 8;

// undici/Node 네트워크 계열 오류인지. 느슨한 message 부분문자열 대신 code/name을 우선 판정.
function isTransientNetworkError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = codeOf(err);
  if (typeof code === "string" && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED"].includes(code)) return true;
  if (typeof code === "string" && code.startsWith("UND_ERR_")) return true; // undici
  const name = "name" in err ? err.name : undefined;
  if (typeof name === "string" && ["FetchError", "AbortError"].includes(name)) return true;
  const msg = String(("message" in err && err.message) || "");
  // "IP discovery"는 @discordjs/voice의 음성 연결 수립 단계(자기 공인 IP:포트 확인) 실패.
  // 일시적 UDP/네트워크 이슈라 해당 서버만 재연결로 복구 가능(전체 몰살할 이유 없음).
  return /terminated|socket hang up|ECONNRESET|ETIMEDOUT|network|IP discovery/i.test(msg);
}

// 네트워크 오류 후: 프로세스는 유지하고, 재생 중이어야 하는데 연결이 끊긴 플레이어만
// 각자의 기존 복구 루프(startConnectionRecovery: forceReconnect + 저장 위치 재개)로 되살린다.
// 정상 재생 중인 서버(연결 Ready)와 이미 스스로 복구 중인 서버는 건드리지 않는다(무영향).
let networkHealInProgress = false;
async function healBrokenPlayers(client: HealClient | null | undefined) {
  if (networkHealInProgress) return; // 오류 폭풍에도 스윕 1회만
  networkHealInProgress = true;
  try {
    if (!client || !client.players) return;
    for (const [guildId, player] of client.players) {
      try {
        if (!player || !player.currentTrack || player.paused) continue; // 되살릴 게 없음
        if (player.isRecovering) continue; // 이미 자체 복구 중. 방해 금지
        const status = player.connection?.state?.status;
        if (status === VoiceConnectionStatus.Ready) continue; // 정상 서버. 무영향
        // 수립 진행 중은 자체 완료/실패를 기다림. 여기서 복구를 겹치면 새 연결을 파괴할 수 있음
        if (status === VoiceConnectionStatus.Connecting || status === VoiceConnectionStatus.Signalling) continue;
        log.info(`서버 ID ${guildId}의 음성 연결이 끊겨 복구를 시작합니다`);
        player.voice.startConnectionRecovery();
      } catch (e) {
        log.error(`플레이어 자가치유 실패 (서버 ID ${guildId}):`, messageOf(e));
      }
    }
  } finally {
    networkHealInProgress = false;
  }
}

// 빈도 가드 팩토리. 짧은 시간창에 오류가 몰리면 시스템적 이상으로 보고 true(→ 안전 종료 승격).
// 오류 종류별로 별도 인스턴스를 사용해 서로의 카운터를 오염시키지 않는다.
function makeFloodGuard(windowMs = NET_ERR_WINDOW_MS, max = NET_ERR_MAX) {
  let times: number[] = [];
  return function flooding() {
    const now = Date.now();
    times = times.filter((t) => now - t < windowMs);
    times.push(now);
    return times.length > max;
  };
}

const networkErrorFlooding = makeFloodGuard();
// 알 수 없는 unhandledRejection용. 단발은 봇을 살리고, 반복(좀비 루프)만 안전 종료로 승격
const unknownRejectionFlooding = makeFloodGuard();
// discord.js client "error"용. 리스너 rejection과 내부 오류가 같이 들어오므로 별도 카운터
const unknownClientErrorFlooding = makeFloodGuard();

// 재시도해도 결과가 같은 Discord API 오류. 로그만 남기고 흘려보낸다(프로세스를 흔들 이유가 없음).
const IGNORABLE_DISCORD_ERRORS: Record<string, { level: "info" | "error"; message: string }> = {
  10062: { level: "info", message: "ℹ️ 만료된 상호작용입니다 (10062 Unknown interaction)" },
  40060: { level: "info", message: "ℹ️ 이미 처리된 상호작용입니다 (40060 Interaction already acknowledged)" },
  50013: { level: "error", message: "❌ 해당 디스코드 작업을 실행할 권한이 없습니다 (50013 Missing permissions)" },
};

function ignorableDiscordError(err: unknown) {
  const code = codeOf(err);
  return (code !== undefined && IGNORABLE_DISCORD_ERRORS[code]) || null;
}

// 치명적 오류: 안전하게 정리하고 종료. 운영자 확인 후 수동 재시작을 기다린다.
// 저장 세션은 초기화한다: 세션 상태 자체가 원인이면 재시작 시 크래시 루프가 되므로.
// (정전 등은 5초 스냅샷이 그대로 남는 별개 경로라 정상 복구된다.)
// exit는 테스트 주입용. 기본은 process.exit(1).
function fatalShutdown(client: FatalClient | null | undefined, error: unknown, exit: () => void = () => process.exit(1)) {
  try {
    if (client && client.players) {
      client.players.forEach((player) => {
        if (player && player.cleanup) player.cleanup("치명적 오류로 종료");
      });
      client.players.clear();
    }
  } catch {
    /* best-effort 정리. 종료 중이므로 실패해도 계속 */
  }
  // 이 줄 다음에 프로세스가 죽는다. 레벨 판정의 fatal 정의 그대로다.
  // 레벨로 거를 때 "봇이 죽은 순간"만 뽑아낼 수 있어야 한다.
  // 구분선 두 줄은 뺐다. fatal 레벨과 색이 이미 눈에 띄고, 한 사건에 네 줄을 찍을 이유가 없다.
  const stack = error && typeof error === "object" && "stack" in error ? error.stack : undefined;
  flog.fatal(
    `치명적 오류로 봇을 안전 종료합니다. 저장된 재생 세션을 초기화했습니다.
${String(stack || error)}`,
  );
  exit();
}

// 클라이언트 오류 · 처리되지 않은 거부 · 잡히지 않은 예외에 처리기를 건다. 기동이 한 번 부른다.
// proc · exit: 처리기를 걸 곳과 안전 종료의 끝. 생략하면 진짜 프로세스
function installErrorHandlers(client: WatchedClient, { proc = process, exit }: { proc?: Proc; exit?: () => void } = {}) {
  // 리스너·프로미스 밖으로 새어나온 오류의 등급 판정. client "error"와 unhandledRejection이 같은 기준을 쓴다.
  // true = 알려진 오류라 처리 완료, false = 알 수 없음(호출부가 빈도 가드로 판단).
  const handleLooseError = (error: unknown, source: string) => {
    const known = ignorableDiscordError(error);
    if (known) {
      if (known.level === "error") coreLog.error(known.message);
      else coreLog.info(known.message);
      return true;
    }

    // 일시적 네트워크/음성 오류(IP discovery 실패 등). 연결이 끊긴 서버만 표적 복구(정상 재생 중인 다른 서버는 무영향).
    if (isTransientNetworkError(error)) {
      coreLog.warn(`네트워크/음성 오류(${source}): 연결이 끊긴 서버의 복구를 시도합니다.`);
      bestEffort(log, healBrokenPlayers(client), "끊긴 서버 복구");
      return true;
    }
    return false;
  };

  // discord.js v14의 AsyncEventEmitter는 async 리스너의 rejection을 잡아 client "error"로 다시 던진다.
  // 리스너가 없으면 그 throw가 타이머 콜백에서 터져 unhandledRejection이 아니라 uncaughtException이 되고,
  // 알 수 없는 오류는 곧바로 안전 종료로 간다. 리스너 하나의 사소한 rejection이 봇 전체를 내린다.
  client.on(Events.Error, (error) => {
    coreLog.error("클라이언트 오류:", error);
    if (handleLooseError(error, "client")) return;

    if (unknownClientErrorFlooding()) {
      coreLog.error(`${NET_ERR_WINDOW_MS / 1000}초 동안 알 수 없는 클라이언트 오류가 ${NET_ERR_MAX}회 발생해 봇을 안전 종료합니다.`);
      fatalShutdown(client, error instanceof Error ? error : new Error(String(error)), exit);
    }
  });

  // 오류 처리
  proc.on("unhandledRejection", (reason) => {
    coreLog.error("처리되지 않은 rejection:", reason);

    if (handleLooseError(reason, "rejection")) return;

    // 알 수 없는 rejection. 단발은 위 로그만 남기고 계속(사소한 catch 누락이 봇 전체 다운으로
    // 번지지 않게). 짧은 시간창에 반복되면 좀비 루프/시스템적 이상으로 보고 안전 종료
    // (uncaughtException의 네트워크 폭주 가드와 같은 방침)
    if (unknownRejectionFlooding()) {
      coreLog.error(`${NET_ERR_WINDOW_MS / 1000}초 동안 알 수 없는 거부가 ${NET_ERR_MAX}회 발생해 봇을 안전 종료합니다.`);
      fatalShutdown(client, reason instanceof Error ? reason : new Error(String(reason)), exit);
    }
  });

  proc.on("uncaughtException", (error) => {
    coreLog.error("처리되지 않은 예외:", error);

    // Discord 상호작용 오류. 무해, 계속
    if (isDeadInteraction(error)) {
      coreLog.info("디스코드 상호작용 오류: 봇의 동작에는 영향이 없습니다.");
      return;
    }

    // 일시적 네트워크 오류. 프로세스는 살리고 "영향받은 서버만" 표적 복구. 짧은 시간에 폭주하면(빈도 가드) 시스템적 이상으로 보고 안전 종료
    if (isTransientNetworkError(error)) {
      if (!networkErrorFlooding()) {
        coreLog.warn("네트워크 오류: 연결이 끊긴 서버의 복구를 시도합니다. 봇은 계속 실행됩니다.");
        bestEffort(log, healBrokenPlayers(client), "끊긴 서버 복구");
        return;
      }
      coreLog.error(`${NET_ERR_WINDOW_MS / 1000}초 동안 네트워크 오류가 ${NET_ERR_MAX}회 발생해 봇을 안전 종료합니다.`);
    }

    // 그 외(또는 네트워크 폭주) = 치명적 → 안전 종료
    fatalShutdown(client, error, exit);
  });
}

export { installErrorHandlers, isTransientNetworkError, healBrokenPlayers, makeFloodGuard, networkErrorFlooding, unknownRejectionFlooding, unknownClientErrorFlooding, ignorableDiscordError, fatalShutdown, NET_ERR_WINDOW_MS, NET_ERR_MAX };
