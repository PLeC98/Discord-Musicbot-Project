"use strict";

// 종료. 신호를 받으면 세션을 저장하고 음성 연결 · 봇 · 자식 프로세스를 정리한 뒤 나간다.

const { getVoiceConnections } = require("@discordjs/voice");
const log = require("../infra/log/logger").child({ category: "core" });
const procRegistry = require("../infra/processRegistry");

// 종료 신호에 처리기를 건다. potServer: 내릴 POToken 서버, logFile: 닫을 로그 파일(없으면 null)
function installShutdown(client, { potServer, logFile }) {
  // Graceful shutdown handler
  const gracefulShutdown = async (signal) => {
    // Save all active player states before shutdown
    const savePromises = [];
    for (const [guildId, player] of client.players) {
      if (player && typeof player.persistState === "function") {
        savePromises.push(
          player.persistState("shutdown", true).catch((err) => {
            log.error(`세션 저장 실패 (서버 ID ${guildId}):`, err);
          }),
        );
      }
    }
    await Promise.all(savePromises);

    // 실제 음성 연결을 기준으로 정리한다.
    // client.players를 돌면 레지스트리에 없는 연결이 그대로 남아, 프로세스가 죽은 뒤에도
    // 봇이 음성 채널에 유령으로 남는다. 재시작하면 "봇은 음성에 있는데 플레이어가 없는" 상태가 된다.
    for (const [guildId, connection] of getVoiceConnections()) {
      const name = client.guilds.cache.get(guildId)?.name ?? guildId;
      const orphan = client.players.has(guildId) ? "" : " | 레지스트리에 없던 연결";
      try {
        connection.destroy();
        log.info(`음성 채널 떠남: ${name} | 원인=프로세스 종료(${signal})${orphan}`);
      } catch (error) {
        log.error(`음성 연결 정리 실패: ${name}`, error);
      }
    }
    client.destroy();
    potServer.stop();

    // 진행 중이던 yt-dlp/FFmpeg를 자손까지 정리한다.
    // 이게 없으면 Windows에서는 봇만 죽고 ffmpeg가 남아 (라이브 등) 무한 다운로드를 계속한다.
    procRegistry.killAll(signal || "shutdown");

    if (logFile) logFile.close();
    process.exit(0);
  };

  // Register shutdown handlers
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGHUP", () => gracefulShutdown("SIGHUP")); // terminal close / SSH disconnect

  // Windows specific handlers
  if (process.platform === "win32") {
    const readline = require("readline");
    if (process.stdin.isTTY) {
      readline
        .createInterface({
          input: process.stdin,
          output: process.stdout,
        })
        .on("SIGINT", () => gracefulShutdown("SIGINT"));
    }
  }
}

module.exports = { installShutdown };
