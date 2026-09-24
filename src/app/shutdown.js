// 종료. 신호를 받으면 세션을 저장하고 음성 연결 · 봇 · 자식 프로세스를 정리한 뒤 나간다.

import readline from "readline";
import { getVoiceConnections } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });
import * as procRegistry from "../infra/processRegistry.ts";

// 바깥 경계. 시험은 가짜를 넘긴다
const REAL = {
  proc: process,
  voiceConnections: () => getVoiceConnections(),
  killAll: (reason) => procRegistry.killAll(reason),
  exit: (code) => process.exit(code),
};

/**
 * 종료 신호에 처리기를 건다.
 * @param {object} deps  potServer: 내릴 POToken 서버, logFile: 닫을 로그 파일(없으면 null), 나머지는 바깥 경계(생략하면 진짜)
 */
function installShutdown(client, { potServer, logFile, ...boundary }) {
  const { proc, voiceConnections, killAll, exit } = { ...REAL, ...boundary };

  let shuttingDown = false;
  const gracefulShutdown = async (signal) => {
    // Windows 콘솔의 Ctrl+C 는 프로세스 신호와 입력 쪽 신호로 두 번 들어온다. 한 번만 한다
    if (shuttingDown) return;
    shuttingDown = true;

    // 켜져 있는 플레이어의 세션을 먼저 저장한다
    const saves = [];
    for (const [guildId, player] of client.players) {
      if (typeof player?.persistState !== "function") continue;
      saves.push(player.persistState("shutdown", true).catch((err) => log.error(`세션 저장 실패 (서버 ID ${guildId}):`, err)));
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
    client.destroy();
    potServer.stop();

    // 진행 중이던 yt-dlp/FFmpeg를 자손까지 정리한다.
    // 이게 없으면 Windows에서는 봇만 죽고 ffmpeg가 남아 (라이브 등) 무한 다운로드를 계속한다.
    killAll(signal || "shutdown");

    if (logFile) logFile.close();
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

const exported = { installShutdown };
export default exported;
export { exported as "module.exports" };
