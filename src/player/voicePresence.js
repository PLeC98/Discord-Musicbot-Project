"use strict";

// 음성 상태 이벤트 해석. 강제 퇴장 · 채널 이동 · 음소거 · 혼자 남음을 가리고, 언제 나가는지는 idleLeave 가 정한다.

const log = require("../infra/log/logger").child({ category: "core" });
const DashboardEvents = require("./events");
const trackState = require("./trackState");

async function onVoiceStateUpdate(client, oldState, newState) {
  const guild = oldState.guild;

  // 채널 이동은 대시보드의 "봇 부르기 / 곡 추가 / 재생 조작" 노출 조건을 바꾼다.
  // 이 알림이 없으면 재생 중일 때만 우연히 갱신된다. 아래 임베드 갱신 훅에 묻어가기 때문에.
  // 마이크 음소거·화면 공유 등도 같은 이벤트로 오지만 노출 조건과 무관하므로 채널이 바뀔 때만.
  if (oldState.channelId !== newState.channelId) DashboardEvents.notify(guild.id);

  const player = client.players.get(guild.id);
  if (!player) return;

  const botId = guild.members.me?.id ?? client.user.id;
  if (oldState.id === botId || newState.id === botId) {
    if (oldState.channelId && !newState.channelId) return forcedOut(client, player, guild);
    await botMoved(client, player, oldState, newState);
    await botMuted(client, player, oldState, newState);
  }
  await listenersChanged(client, player, guild, oldState, newState);
}

// 봇이 음성에서 쫓겨났다. 화면을 끝난 모양으로 바꾸고 플레이어를 버린다
async function forcedOut(client, player, guild) {
  try {
    player.pendingEndReason = "forced-disconnect";
    trackState.reset(player);
    await client.musicEmbedManager?.handlePlaybackEnd(player, { reason: "disconnected" });
  } catch (error) {
    log.error("강제 연결 해제 후 재생 UI 갱신 실패:", error);
  } finally {
    player.cleanup("봇이 음성에서 강제 퇴장됨");
    client.players.delete(guild.id);
  }
}

// 누가 봇을 다른 채널로 옮겼다. 연결은 음성 라이브러리가 따라가고, 여기서는 기록과 화면을 맞춘다
async function botMoved(client, player, oldState, newState) {
  if (!newState.channelId || oldState.channelId === newState.channelId || !newState.channel) return;
  player.voice.followMove(oldState.channelId, newState.channel);
  player.idle.cancelAlone(false);
  await client.musicEmbedManager?.updateNowPlayingEmbed(player);
}

// 서버 음소거 · 헤드셋 끄기 · 무대 발언권 없음은 들을 수 없으니 멈춘다
async function botMuted(client, player, oldState, newState) {
  const wasMuted = oldState.serverMute || oldState.serverDeaf || oldState.suppress;
  const isMuted = newState.serverMute || newState.serverDeaf || newState.suppress;
  if (!wasMuted && isMuted) {
    if (player.pauseFor("mute")) await client.musicEmbedManager?.updateNowPlayingEmbed(player);
  } else if (wasMuted && !isMuted) {
    const resumed = player.resumeFor("mute");
    if (resumed || !player.pauseReasons.has("mute")) await client.musicEmbedManager?.updateNowPlayingEmbed(player);
  }
}

// 봇의 채널에 사람이 남았나. 없으면 혼자 남음을 시작하고, 돌아오면 푼다
async function listenersChanged(client, player, guild, oldState, newState) {
  const voiceChannelId = player.voiceChannel?.id;
  if (!voiceChannelId || (oldState.channelId !== voiceChannelId && newState.channelId !== voiceChannelId)) return;

  const channel = guild.channels.cache.get(voiceChannelId);
  if (!channel) {
    player.cleanup("봇의 음성 채널이 사라짐");
    client.players.delete(guild.id);
    return;
  }

  const someone = channel.members.filter((member) => !member.user.bot).size > 0;
  const wasAlone = player.pauseReasons.has("alone");
  if (someone) player.idle.cancelAlone(true);
  else player.idle.startAlone();
  // 멈춤이 바뀌었을 때만 패널을 고친다(혼자 남아 멈춤 · 돌아와 풂)
  if (wasAlone === someone && player.currentTrack) await client.musicEmbedManager?.updateNowPlayingEmbed(player);
}

module.exports = { onVoiceStateUpdate };
