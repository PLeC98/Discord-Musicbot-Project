// 음성 상태 이벤트 해석. 봇 자신의 상태(빠짐 · 이동 · 음소거)는 음성 연결(voiceLink)에 넘기고, 여기서는 봇 채널의 사람 수(혼자 남음)를 본다. 언제 나가는지는 idleLeave 가 정한다.

import * as playerEvents from "./events.ts";
import type { Client, Guild, VoiceState } from "discord.js";
import type { Player } from "./player.ts";
import type { PlayerSeats } from "./registry.ts";

async function onVoiceStateUpdate(client: Client, players: Pick<PlayerSeats, "get">, oldState: VoiceState, newState: VoiceState) {
  const guild = oldState.guild;

  // 채널 이동은 대시보드의 "봇 부르기 / 곡 추가 / 재생 조작" 노출 조건을 바꾼다.
  // 이 알림이 없으면 재생 중일 때만 우연히 갱신된다. 아래 임베드 갱신 훅에 묻어가기 때문에.
  // 마이크 음소거·화면 공유 등도 같은 이벤트로 오지만 노출 조건과 무관하므로 채널이 바뀔 때만.
  if (oldState.channelId !== newState.channelId) playerEvents.touched(guild.id);

  const player = players.get(guild.id);
  if (!player) return;

  const botId = guild.members.me?.id ?? client.user?.id;
  if (oldState.id === botId || newState.id === botId) {
    // 봇 자신의 음성 상태(빠짐 · 옮겨짐 · 서버 음소거)는 음성 연결이 구분한다
    const change = player.voice.onBotState(oldState, newState);
    if (change.left) return;
    // 옮겨진 곳에서는 혼자 남음을 새로 본다(아래 사람 수 보기가 다시 건다)
    if (change.moved) player.idle.cancelAlone(false);
    if (change.moved || change.muteChanged) await playerEvents.refresh(player);
  }
  await listenersChanged(client, player, guild, oldState, newState);
}

// 봇의 채널에 사람이 남았나. 없으면 혼자 남음을 시작하고, 돌아오면 푼다
async function listenersChanged(client: Client, player: Player, guild: Guild, oldState: VoiceState, newState: VoiceState) {
  const voiceChannelId = player.voiceChannel?.id;
  if (!voiceChannelId || (oldState.channelId !== voiceChannelId && newState.channelId !== voiceChannelId)) return;

  const channel = guild.channels.cache.get(voiceChannelId);
  if (!channel?.isVoiceBased()) {
    player.voice.channelGone();
    return;
  }

  const someone = channel.members.filter((member) => !member.user.bot).size > 0;
  const wasAlone = player.pauseReasons.has("alone");
  if (someone) player.idle.cancelAlone(true);
  else player.idle.startAlone();
  // 멈춤이 바뀌었을 때만 패널을 고친다(혼자 남아 멈춤 · 돌아와 풂)
  if (wasAlone === someone && player.currentTrack) await playerEvents.refresh(player);
}

export { onVoiceStateUpdate };
