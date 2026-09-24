// 종료. 신호를 받으면 세션을 저장하고 음성 연결 · 봇 · 자식 프로세스를 정리한 뒤 나간다.
// 기동이 실패했을 때도 띄운 것을 내리고 나간다.

import readline from "readline";
import { getVoiceConnections } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });
import * as procRegistry from "../infra/processRegistry.ts";

// 바깥 경계. 시험은 가짜를 넘긴다
type Boundary = {
  proc: Pick<NodeJS.Process, "on" | "platform" | "stdin" | "stdout">;
  /** 음성 라이브러리가 들고 있는 연결 */
  voiceConnections(): Iterable<readonly [string, { destroy(): unknown }]>;
  killAll(reason: string): unknown;
  exit(code: number): unknown;
};
const REAL: Boundary = {
  proc: process,
  voiceConnections: () => getVoiceConnections(),
  killAll: (reason) => procRegistry.killAll(reason),
  exit: (code) => process.exit(code),
};
/** 내릴 POToken 서버, 닫을 로그 파일(없으면 null), 나머지는 바깥 경계(생략하면 진짜) */
type ShutdownDeps = { potServer: { stop(): unknown }; logFile: { close(): unknown } | null } & Partial<Boundary>;
/** 종료할 때 세션을 저장하고 음성을 끊을 플레이어 */
type Saver = { persistState(reason: string, immediate: boolean): Promise<unknown>; disconnect?(reason: string): unknown };
// 기동이 실패하면 이만큼 뒤에 나간다. 곧바로 나가면 막 끝난 REST 요청(로그인 · 명령 배포)의 핸들 정리와 겹쳐
// Windows 에서 libuv 어서션으로 죽는다(Node 24). 요청 하나와 곧바로 부른 process.exit 만으로 재현된다
const FAILED_START_GRACE_MS = 1000;

/** 종료할 때 쓰는 클라이언트 칸 */
type ShutdownClient = { players: Iterable<readonly [string, Saver | null]>; guilds: { cache: { get(id: string): { name?: string } | undefined } }; destroy(): unknown };

/** 종료 신호에 처리기를 건다 */
function installShutdown(client: ShutdownClient, { potServer, logFile, ...boundary }: ShutdownDeps) {
  const { proc, voiceConnections, killAll, exit } = { ...REAL, ...boundary };

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    // Windows 콘솔의 Ctrl+C 는 프로세스 신호와 입력 쪽 신호로 두 번 들어온다. 한 번만 한다
    if (shuttingDown) return;
    shuttingDown = true;

    // 켜져 있는 플레이어의 세션을 먼저 저장한다
    const saves = [];
    for (const [guildId, player] of client.players) {
      if (typeof player?.persistState !== "function") continue;
      saves.push(player.persistState("shutdown", true).catch((err: unknown) => log.error(`세션 저장 실패 (서버 ID ${guildId}):`, err)));
    }
    await Promise.all(saves);

    // 플레이어의 음성 연결은 플레이어가 끊는다. 리스너를 먼저 떼므로 "연결이 끊겼으니 복구" 로 받지 않는다
    const reason = `프로세스 종료(${signal})`;
    for (const [, player] of client.players) player?.disconnect?.(reason);

    // 남은 것은 레지스트리에 없던 연결이다. 그대로 두면 프로세스가 죽은 뒤에도 봇이 음성 채널에
    // 유령으로 남는다. 재시작하면 "봇은 음성에 있는데 플레이어가 없는" 상태가 된다.
    for (const [guildId, connection] of voiceConnections()) {
      const name = client.guilds.cache.get(guildId)?.name ?? guildId;
      try {
        connection.destroy();
        log.info(`음성 채널 떠남: ${name} | 원인=${reason} | 레지스트리에 없던 연결`);
      } catch (error) {
        log.error(`음성 연결 정리 실패: ${name}`, error);
      }
    }
    release(client, { potServer, logFile, killAll }, signal || "shutdown");
    exit(0);
  };

  proc.on("SIGINT", () => gracefulShutdown("SIGINT"));
  proc.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  proc.on("SIGHUP", () => gracefulShutdown("SIGHUP")); // 터미널 닫힘 · SSH 끊김

  // Windows 콘솔의 Ctrl+C 는 프로세스 신호로 안 오는 때가 있어 입력 쪽에서도 받는다
  if (proc.platform === "win32" && proc.stdin.isTTY) {
    readline.createInterface({ input: proc.stdin, output: proc.stdout }).on("SIGINT", () => gracefulShutdown("SIGINT"));
  }
}

/** 기동이 실패했다. 띄운 것을 내리고 잠시 뒤 1 로 나간다 */
function stopFailedStart(client: { destroy(): unknown }, { potServer, logFile, ...boundary }: ShutdownDeps, graceMs = FAILED_START_GRACE_MS) {
  const { killAll, exit } = { ...REAL, ...boundary };
  release(client, { potServer, logFile, killAll }, "기동 실패");
  setTimeout(() => exit(1), graceMs);
}

// 봇이 띄운 것을 내린다. 클라이언트 · POToken 서버 · 자식 프로세스 · 로그 파일
function release(client: { destroy(): unknown }, { potServer, logFile, killAll }: Pick<ShutdownDeps, "potServer" | "logFile"> & Pick<Boundary, "killAll">, reason: string) {
  client.destroy();
  potServer.stop();

  // 진행 중이던 yt-dlp/FFmpeg를 자손까지 정리한다.
  // 이게 없으면 Windows에서는 봇만 죽고 ffmpeg가 남아 (라이브 등) 무한 다운로드를 계속한다.
  killAll(reason);

  if (logFile) logFile.close();
}

export { installShutdown, stopFailedStart };
export type { Boundary as ShutdownBoundary };
