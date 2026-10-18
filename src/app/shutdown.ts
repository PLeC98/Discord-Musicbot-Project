// 종료. 신호를 받으면 세션을 저장하고 음성 연결(채널에는 남는다) · 봇 · 자식 프로세스를 정리한 뒤 나간다.
// 대시보드의 다시 시작도 같은 길로 정리하고 EXIT.restart 로 나간다(실행기가 다시 실행한다).
// 처리기는 기동 맨 앞(POToken 서버를 실행하기 전)에 걸고, 봇은 만든 뒤에 붙인다. 붙이기 전에 끄면 실행한 것만 내리고 깨끗이 끝났다고 적는다.
// 기동이 실패했을 때도 실행한 것을 내리고 나간다.

import readline from "readline";
import { getVoiceConnections } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });
import * as procRegistry from "../infra/process-registry.ts";
import { messageOf } from "../rules/error-kind.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import { runRecord } from "./run-record.ts";

// 바깥 경계. 테스트는 가짜를 넘긴다
type Boundary = {
  proc: Pick<NodeJS.Process, "on" | "platform" | "stdin" | "stdout">;
  /** 음성 라이브러리가 들고 있는 연결 */
  voiceConnections(): Iterable<readonly [string, { destroy(adapterAvailable?: boolean): unknown }]>;
  killAll(reason: string): unknown;
  exit(code: number): unknown;
  /** 실행 기록. 끝난 방식을 적는다 */
  record: Pick<typeof runRecord, "end">;
};
const REAL: Boundary = {
  proc: process,
  voiceConnections: () => getVoiceConnections(),
  killAll: (reason) => procRegistry.killAll(reason),
  exit: (code) => process.exit(code),
  record: runRecord,
};
/** 내릴 POToken 서버, 닫을 로그 파일(없으면 null), 나머지는 바깥 경계(생략하면 진짜) */
type ShutdownDeps = { potServer: { stop(): unknown }; logFile: { close(): unknown } | null } & Partial<Boundary>;
/** 종료할 때 세션을 저장하고 음성 연결을 정리할 플레이어 */
type Saver = { persistence: { persistState(reason: string): Promise<unknown> }; voice: { release(reason: string): unknown }; updateVoiceStatus(status: string): Promise<unknown> };
// 음성 채널 상태 문구를 지우는 데 기다리는 상한. 넘으면 그대로 끝낸다
const STATUS_CLEAR_MS = 2000;
// 기동이 실패하면 이만큼 뒤에 나간다. 곧바로 나가면 막 끝난 REST 요청(로그인 · 명령 배포)의 핸들 정리와 겹쳐
// Windows 에서 libuv 어서션으로 죽는다(Node 24). 요청 하나와 곧바로 부른 process.exit 만으로 재현된다
const FAILED_START_GRACE_MS = 1000;

/** 종료할 때 쓰는 것. 디스코드 클라이언트(서버 이름 · 내리기)와 서버마다의 플레이어 */
type ShutdownBot = { client: { guilds: { cache: { get(id: string): { name?: string } | undefined } }; destroy(): unknown }; players: Iterable<readonly [string, Saver | null]> };

/** 종료 신호에 처리기를 건다. 돌려주는 attach 로 봇을 붙인다 */
function installShutdown({ potServer, logFile, ...boundary }: ShutdownDeps) {
  const { proc, voiceConnections, killAll, exit, record } = { ...REAL, ...boundary };

  let bot: ShutdownBot | null = null;
  let shuttingDown = false;
  // why: 로그 · 연결 정리에 적는 까닭. restart 면 다시 시작 코드로 나간다
  const gracefulShutdown = async (why: string, restart = false) => {
    // Windows 콘솔의 Ctrl+C 는 프로세스 신호와 입력 쪽 신호로 두 번 들어온다. 한 번만 한다
    if (shuttingDown) return;
    shuttingDown = true;
    const client = bot?.client ?? null;
    const reason = restart ? `다시 시작(${why})` : `프로세스 종료(${why})`;
    if (bot) await savePlayers(bot.players, reason);

    // 레지스트리에 없던 연결도 채널에는 남긴 채 정리한다
    for (const [guildId, connection] of voiceConnections()) {
      const name = client?.guilds.cache.get(guildId)?.name ?? guildId;
      try {
        connection.destroy(false);
        log.info(`음성 연결 정리(채널에는 남음): ${name} | 원인=${reason} | 레지스트리에 없던 연결`);
      } catch (error) {
        log.error(`음성 연결 정리 실패: ${name}`, error);
      }
    }
    record.end(restart ? "restart" : "shutdown");
    release(client, { potServer, logFile, killAll }, why || "shutdown");
    exit(restart ? EXIT.restart : EXIT.stopped);
  };

  // 종료가 중간에 던져도 나간다. 못 한 정리는 프로세스와 함께 닫힌다(다시 시작이었으면 그래도 다시 실행하게 같은 코드로)
  const stop = (why: string, restart = false) => {
    gracefulShutdown(why, restart).catch((error: unknown) => {
      log.error("종료 중 오류:", error);
      exit(restart ? EXIT.restart : EXIT.stopped);
    });
  };
  const onSignal = (signal: string) => stop(signal);
  proc.on("SIGINT", () => onSignal("SIGINT"));
  proc.on("SIGTERM", () => onSignal("SIGTERM"));
  proc.on("SIGHUP", () => onSignal("SIGHUP")); // 터미널 닫힘 · SSH 끊김

  // Windows 콘솔의 Ctrl+C 는 프로세스 신호로 안 오는 때가 있어 입력 쪽에서도 받는다
  if (proc.platform === "win32" && proc.stdin.isTTY) {
    readline.createInterface({ input: proc.stdin, output: proc.stdout }).on("SIGINT", () => onSignal("SIGINT"));
  }

  return {
    /** 봇(클라이언트 · 플레이어)을 붙인다. 이제부터 끄면 세션을 저장하고 연결 · 봇까지 정리한다 */
    attach(next: ShutdownBot) {
      bot = next;
    },
    /** 정리하고 다시 시작 코드로 나간다. 실행기가 다시 실행한다. by: 누가(로그) */
    restart(by: string) {
      stop(by, true);
    },
  };
}

// 플레이어의 세션을 저장하고, 음성 채널 상태 문구를 지우고, 채널에는 남긴 채 연결을 정리한다
async function savePlayers(players: ShutdownBot["players"], reason: string) {
  const saves = [];
  for (const [guildId, player] of players) {
    if (!player) continue;
    saves.push(player.persistence.persistState("shutdown").catch((err: unknown) => log.error(`세션 저장 실패 (서버 ID ${guildId}):`, err)));
  }
  await Promise.all(saves);

  // 음성 채널에는 남는다(곧바로 다시 시작하면 나갔다 들어오지 않고 이어 튼다). 재생 중이던 곡 이름이 소리 없이 떠 있지 않게 상태 문구만 지운다
  const clears = [];
  for (const [, player] of players) if (player) clears.push(player.updateVoiceStatus("").catch((error: unknown) => log.warn(`음성 채널 상태 지우기 실패: ${messageOf(error)}`)));
  let cap: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(clears), new Promise((done) => (cap = setTimeout(done, STATUS_CLEAR_MS)))]);
  clearTimeout(cap);

  // 이 쪽 연결만 정리한다. 리스너를 먼저 떼므로 "연결이 끊겼으니 복구" 로 받지 않는다
  for (const [, player] of players) player?.voice.release(reason);
}

/** 기동이 실패했다. 실행한 것을 내리고 잠시 뒤 code(설정 · 토큰이 틀림 또는 일시적 실패)로 나간다 */
function stopFailedStart(client: { destroy(): unknown } | null, { potServer, logFile, ...boundary }: ShutdownDeps, code: ExitCode, graceMs = FAILED_START_GRACE_MS) {
  const { killAll, exit, record } = { ...REAL, ...boundary };
  record.end("startup-failed");
  release(client, { potServer, logFile, killAll }, "기동 실패");
  setTimeout(() => exit(code), graceMs);
}

// 봇이 실행한 것을 내린다. 클라이언트 · POToken 서버 · 자식 프로세스 · 로그 파일
function release(client: { destroy(): unknown } | null, { potServer, logFile, killAll }: Pick<ShutdownDeps, "potServer" | "logFile"> & Pick<Boundary, "killAll">, reason: string) {
  client?.destroy();
  potServer.stop();

  // 진행 중이던 yt-dlp/FFmpeg를 자손까지 정리한다.
  // 이게 없으면 Windows에서는 봇만 죽고 ffmpeg가 남아 (라이브 등) 무한 다운로드를 계속한다.
  killAll(reason);

  if (logFile) logFile.close();
}

export { installShutdown, stopFailedStart };
export type { Boundary as ShutdownBoundary };
