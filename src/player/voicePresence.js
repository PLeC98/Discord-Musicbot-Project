"use strict";

// 음성 상태 이벤트 해석. 강제 퇴장 · 채널 이동 · 음소거 · 혼자 남음을 가리고, 언제 나가는지는 idleLeave 가 정한다.

const log = require("../infra/log/logger").child({ category: "core" });
const DashboardEvents = require("./events");
const trackState = require("./trackState");

// Handle voice state updates for pause/resume and cleanup
async function onVoiceStateUpdate(client, oldState, newState) {
  const guild = oldState.guild;

  // 채널 이동은 대시보드의 "봇 부르기 / 곡 추가 / 재생 조작" 노출 조건을 바꾼다.
  // 이 알림이 없으면 재생 중일 때만 우연히 갱신된다. 아래 임베드 갱신 훅에 묻어가기 때문에.
  // 마이크 음소거·화면 공유 등도 같은 이벤트로 오지만 노출 조건과 무관하므로 채널이 바뀔 때만.
  if (oldState.channelId !== newState.channelId) DashboardEvents.notify(guild.id);

  const player = client.players.get(guild.id);
  if (!player) return;

  const botMember = guild.members.me;
  const botId = botMember?.id ?? client.user.id;
  const involvesBot = oldState.id === botId || newState.id === botId;

  if (involvesBot) {
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    if (oldChannelId && !newChannelId) {
      try {
        const embedManager = client.musicEmbedManager;

        // Mark state as ended so UI reflects the change
        player.pendingEndReason = "forced-disconnect";
        trackState.reset(player);

        await embedManager?.handlePlaybackEnd(player, { reason: "disconnected" });
      } catch (error) {
        log.error("강제 연결 해제 후 재생 UI 갱신 실패:", error);
      } finally {
        player.cleanup("봇이 음성에서 강제 퇴장됨");
        client.players.delete(guild.id);
      }
      return;
    }

    if (newChannelId && oldChannelId !== newChannelId) {
      if (newState.channel) {
        await player.moveToChannel(newState.channel);
        player.idle.cancelAlone(false);
        if (client.musicEmbedManager) {
          await client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
      }
    }

    const wasMuted = oldState.serverMute || oldState.serverDeaf || oldState.suppress;
    const isMuted = newState.serverMute || newState.serverDeaf || newState.suppress;

    if (!wasMuted && isMuted) {
      const paused = player.pauseFor("mute");
      if (paused && client.musicEmbedManager) {
        await client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
    } else if (wasMuted && !isMuted) {
      const resumed = player.resumeFor("mute");
      if (client.musicEmbedManager && (resumed || !player.pauseReasons.has("mute"))) {
        await client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
    }
  }

  const voiceChannelId = player.voiceChannel?.id;
  if (!voiceChannelId) return;

  if (oldState.channelId === voiceChannelId || newState.channelId === voiceChannelId) {
    const channel = guild.channels.cache.get(voiceChannelId);

    if (!channel) {
      player.cleanup("봇의 음성 채널이 사라짐");
      client.players.delete(guild.id);
      return;
    }

    const listeners = channel.members.filter((member) => !member.user.bot).size;

    if (listeners === 0) {
      const alreadyPaused = player.pauseReasons.has("alone");
      player.idle.startAlone();
      if (!alreadyPaused && client.musicEmbedManager && player.currentTrack) {
        await client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
    } else {
      const wasPausedForAlone = player.pauseReasons.has("alone");
      player.idle.cancelAlone(true);
      if (wasPausedForAlone && client.musicEmbedManager && player.currentTrack) {
        await client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
    }
  }
}

module.exports = { onVoiceStateUpdate };
