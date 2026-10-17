// 프로세스 수준에서 새어 나온 오류. 기동이 installErrorHandlers 로 처리기를 건다.
//
// 방침(notes/plan-refactor-2.md #26): 봇 전체를 내리지 않고 서버 하나로 가둔다.
// - 아는 오류는 난 자리에서 가른다(오류 목록). 여기까지 오는 것 가운데 이미 아는 디스코드 코드는 로그만 남긴다.
// - 서버 문맥(infra/guild-context)이 있으면 그 서버의 오류다. 그 서버만 다시 켠다(guildFault).
// - 서버를 모르면 경계가 빠진 자리다. 로그로 남기고 계속 돈다. 서버를 가리지 않고 쏟아질 때만 내린다(전역 폭주).
// 네트워크 복구는 음성 연결 상태 기계(player/voice-link)와 discord.js 가 맡는다. 여기서 플레이어를 복구하지 않는다.

import logger from "../infra/log/logger.ts";
import { Events } from "discord.js";
import { currentGuild } from "../infra/guild-context.ts";
import { errorKind, codeOf, messageOf } from "../rules/error-kind.ts";
import { EXIT } from "./exit-codes.ts";
import { runRecord } from "./run-record.ts";
import type { GuildFault } from "./guild-fault.ts";

const flog = logger.child({ category: "core", sub: "fatal" });
const coreLog = logger.child({ category: "core" });

/** 치명적 오류로 내릴 때 세션을 저장하고 연결을 정리할 플레이어 */
type Savable = { persistence: { saveNow(reason: string): unknown }; voice: { release(reason: string): unknown } };
/** 서버마다의 플레이어 */
type Savables = Pick<Map<string, Savable | null>, "forEach">;
/** 오류 처리기를 걸 클라이언트 */
type WatchedClient = { on(event: "error", listener: (error: Error) => void): unknown };
/** 처리되지 않은 거부 · 예외를 알리는 곳(프로세스) */
type Proc = { on(event: "unhandledRejection" | "uncaughtException", listener: (error: unknown) => void): unknown };

// 전역 폭주 판정. 이 시간창에 서버를 모르는 오류가 이보다 많으면 내린다
const FLOOD_WINDOW_MS = 60_000;
const FLOOD_MAX = 8;

// 빈도 가드. 시간창 안에 max 번을 넘으면 true
function makeFloodGuard(windowMs = FLOOD_WINDOW_MS, max = FLOOD_MAX) {
  let times: number[] = [];
  return function flooding(now = Date.now()) {
    times = times.filter((t) => now - t < windowMs);
    times.push(now);
    return times.length > max;
  };
}

// 다시 해도 결과가 같은 디스코드 API 오류. 여기까지 왔으면 난 자리가 받지 않은 것이라 로그만 남긴다
const KNOWN_DISCORD_ERRORS: Record<number, { level: "info" | "error"; message: string }> = {
  10062: { level: "info", message: "만료된 상호작용입니다 (10062 Unknown interaction)" },
  40060: { level: "info", message: "이미 처리된 상호작용입니다 (40060 Interaction already acknowledged)" },
  50013: { level: "error", message: "해당 디스코드 작업을 실행할 권한이 없습니다 (50013 Missing permissions)" },
};

function knownDiscordError(err: unknown) {
  const code = codeOf(err);
  return (typeof code === "number" && KNOWN_DISCORD_ERRORS[code]) || null;
}

// 치명적 오류: 세션을 저장하고 음성 채널에는 남긴 채 연결을 정리한 뒤 내린다(다시 켜면 그 자리에서 이어 튼다).
// 세션이 까닭이라 켤 때마다 다시 죽는 것은 실행 기록이 막는다(짧게 끊긴 실행이 연달아면 복원하지 않는다, app/run-record).
// exit · record 는 시험이 넘긴다. 기본은 전역 폭주 코드로 나가기와 봇의 실행 기록
function fatalShutdown(players: Savables | null | undefined, error: unknown, { exit = () => process.exit(EXIT.globalFlood), record = runRecord }: { exit?: () => void; record?: Pick<typeof runRecord, "end"> } = {}) {
  players?.forEach((player, guildId) => {
    if (!player) return;
    try {
      player.persistence.saveNow("shutdown");
    } catch (e) {
      flog.error(`세션 저장 실패 (서버 ID ${guildId}): ${messageOf(e)}`);
    }
    try {
      player.voice.release("치명적 오류");
    } catch {
      // 내리는 중이다. 연결은 프로세스와 함께 닫힌다
    }
  });
  record.end("global-flood");
  // 이 줄 다음에 프로세스가 죽는다. 레벨로 거를 때 "봇이 죽은 순간"만 뽑아낼 수 있어야 한다
  const stack = error && typeof error === "object" && "stack" in error ? error.stack : undefined;
  flog.fatal(
    `서버를 가리지 않는 오류가 쏟아져 봇을 내립니다. 재생 세션은 저장했습니다(다시 켜면 이어서 틉니다).
${String(stack || error)}`,
  );
  exit();
}

/** 처리기에 넘기는 것. players: 내릴 때 세션을 저장할 플레이어 · fault: 서버 하나 다시 켜기(없으면 로그만) · proc · exit · record: 시험이 넘긴다 */
type Options = { players?: Savables; fault?: GuildFault; proc?: Proc; exit?: () => void; record?: Pick<typeof runRecord, "end"> };

// 클라이언트 오류 · 처리되지 않은 거부 · 잡히지 않은 예외에 처리기를 건다. 기동이 한 번 부른다
function installErrorHandlers(client: WatchedClient, { players, fault, proc = process, exit, record }: Options = {}) {
  const flooding = makeFloodGuard();

  const loose = (error: unknown, source: string) => {
    const known = knownDiscordError(error);
    if (known) {
      coreLog[known.level](`${known.message} (${source})`);
      return;
    }
    const guildId = currentGuild();
    if (guildId && fault) {
      fault(guildId, error, source).catch((e: unknown) => coreLog.error(`서버 ${guildId} 오류 처리 실패:`, e));
      return;
    }
    // 서버를 모른다: 경계가 빠진 자리다. 게이트웨이 · 네트워크 오류는 discord.js 가 스스로 다시 붙는다
    if (errorKind(error) === "network-error") coreLog.warn(`경계 밖의 네트워크 오류 (${source}): ${messageOf(error)}`);
    else coreLog.error(`경계가 빠진 자리에서 새어 나온 오류 (${source}):`, error);
    if (flooding()) {
      coreLog.error(`${FLOOD_WINDOW_MS / 1000}초 동안 서버를 모르는 오류가 ${FLOOD_MAX}번을 넘었습니다`);
      fatalShutdown(players, error, { exit, record });
    }
  };

  // discord.js 가 알리는 오류. 처리기의 거부는 경계(app/event-boundary)가 받으므로 여기는 라이브러리 안의 오류다
  client.on(Events.Error, (error) => loose(error, "client"));
  proc.on("unhandledRejection", (reason) => loose(reason, "rejection"));
  proc.on("uncaughtException", (error) => loose(error, "exception"));
}

export { installErrorHandlers, fatalShutdown, makeFloodGuard, knownDiscordError, FLOOD_WINDOW_MS, FLOOD_MAX };
