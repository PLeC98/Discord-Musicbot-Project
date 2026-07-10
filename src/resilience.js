"use strict";

// 프로세스 레벨 오류 복원력 헬퍼 (index.js의 uncaughtException 핸들러에서 사용).
//
// 방침: 일시적 네트워크 오류는 프로세스를 살린 채 "영향받은 서버만" 표적 복구하고,
//       진짜 치명적 오류는 안전하게 종료해 운영자(봇 관리자)의 확인·수동 재시작을 대기.

const chalk = require("chalk");
const { VoiceConnectionStatus } = require("@discordjs/voice");

// 네트워크 오류 폭주 판정용 시간창
const NET_ERR_WINDOW_MS = 60000;
const NET_ERR_MAX = 8;

// undici/Node 네트워크 계열 오류인지 — 느슨한 message 부분문자열 대신 code/name을 우선 판정.
function isTransientNetworkError(err) {
  if (!err) return false;
  const code = err.code;
  if (code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED"].includes(code)) return true;
  if (typeof code === "string" && code.startsWith("UND_ERR_")) return true; // undici
  const name = err.name;
  if (name && ["FetchError", "AbortError"].includes(name)) return true;
  const msg = err.message || "";
  // "IP discovery"는 @discordjs/voice의 음성 연결 수립 단계(자기 공인 IP:포트 확인) 실패 —
  // 일시적 UDP/네트워크 이슈라 해당 서버만 재연결로 복구 가능(전체 몰살할 이유 없음).
  return /terminated|socket hang up|ECONNRESET|ETIMEDOUT|network|IP discovery/i.test(msg);
}

// 네트워크 오류 후: 프로세스는 유지하고, 재생 중이어야 하는데 연결이 끊긴 플레이어만
// 각자의 기존 복구 루프(startConnectionRecovery: forceReconnect + 저장 위치 재개)로 되살린다.
// 정상 재생 중인 서버(연결 Ready)와 이미 스스로 복구 중인 서버는 건드리지 않는다(무영향).
let networkHealInProgress = false;
async function healBrokenPlayers(client) {
  if (networkHealInProgress) return; // 오류 폭풍에도 스윕 1회만
  networkHealInProgress = true;
  try {
    if (!client || !client.players) return;
    for (const [guildId, player] of client.players) {
      try {
        if (!player || !player.currentTrack || player.paused) continue; // 되살릴 게 없음
        if (player.isRecovering) continue; // 이미 자체 복구 중 — 방해 금지
        const status = player.connection && player.connection.state && player.connection.state.status;
        if (status === VoiceConnectionStatus.Ready) continue; // 정상 서버 — 무영향
        console.log(chalk.yellow(`🔧 서버 ${guildId} 음성 연결이 끊겨 복구를 시작합니다...`));
        player.voice.startConnectionRecovery();
      } catch (e) {
        console.error(chalk.red(`❌ 플레이어 자가치유 실패 (guild ${guildId}):`), e.message);
      }
    }
  } finally {
    networkHealInProgress = false;
  }
}

// 빈도 가드 — 짧은 시간창에 네트워크 오류가 몰리면 시스템적 이상으로 보고 true(→ 안전 종료 승격).
let networkErrorTimes = [];
function networkErrorFlooding() {
  const now = Date.now();
  networkErrorTimes = networkErrorTimes.filter((t) => now - t < NET_ERR_WINDOW_MS);
  networkErrorTimes.push(now);
  return networkErrorTimes.length > NET_ERR_MAX;
}

// 치명적 오류: 안전하게 정리하고 종료 — 운영자 확인 후 수동 재시작을 기다린다.
// 저장 세션은 초기화한다: 세션 상태 자체가 원인이면 재시작 시 크래시 루프가 되므로.
// (정전 등은 5초 스냅샷이 그대로 남는 별개 경로라 정상 복구된다.)
// exit는 테스트 주입용 — 기본은 process.exit(1).
function fatalShutdown(client, error, exit = () => process.exit(1)) {
  try {
    if (client && client.players) {
      client.players.forEach((player) => {
        if (player && player.cleanup) player.cleanup();
      });
      client.players.clear();
    }
  } catch {
    /* best-effort 정리 — 종료 중이므로 실패해도 계속 */
  }
  console.error(chalk.red("════════════════════════════════════════════════════════"));
  console.error(chalk.red("💀 치명적 오류로 봇을 안전 종료합니다. 저장된 재생 세션을 초기화했습니다."));
  console.error(chalk.red(String((error && error.stack) || error)));
  console.error(chalk.red("════════════════════════════════════════════════════════"));
  exit();
}

module.exports = {
  isTransientNetworkError,
  healBrokenPlayers,
  networkErrorFlooding,
  fatalShutdown,
  NET_ERR_WINDOW_MS,
  NET_ERR_MAX,
};
