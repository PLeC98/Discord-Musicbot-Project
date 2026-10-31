// 음성 상태 이벤트 해석. 봇 자신의 상태(빠짐 · 이동)는 음성 연결(voiceLink)에 넘기고, 봇 채널에 관한 이벤트면 억제 사유를 지금 상태로 맞춘다(player.syncHolds). 언제 나가는지는 idleLeave 가 정한다.

import * as playerEvents from "./events.ts";
import { ChannelType, type Client, type VoiceState } from "discord.js";
import * as staySeats from "../store/stay-seats.ts";
import type { Player } from "./player.ts";
import type { PlayerSeats } from "./registry.ts";

async function onVoiceStateUpdate(client: Client, players: Pick<PlayerSeats, "get">, oldState: VoiceState, newState: VoiceState) {
  const guild = oldState.guild;

  // 채널 이동은 대시보드의 버튼 노출 조건을 바꾸므로 알린다(재생 중이 아니면 따로 갱신할 계기가 없다).
  // 마이크 음소거 · 화면 공유도 같은 이벤트로 오지만 노출 조건과 무관하므로 채널이 바뀔 때만.
  if (oldState.channelId !== newState.channelId) playerEvents.touched(guild.id);

  const player = players.get(guild.id);
  if (!player) return;

  const bot = botChange(client, player, oldState, newState);
  if (bot.left) return;
  const moved = bot.moved;
  if (moved) followSeat(player, oldState.channelId);
  const channelId = player.voiceChannel?.id;
  if (!channelId || (!moved && oldState.channelId !== channelId && newState.channelId !== channelId)) return;
  if (!guild.channels.cache.get(channelId)?.isVoiceBased()) {
    player.voice.channelGone();
    return;
  }
  // 억제 사유(음소거 · 스테이지 · 혼자)를 지금 상태로. 패널 갱신 · 혼자 남음 타이머는 바뀐 만큼 거기서 따라온다
  player.syncHolds({ moved });
  // 옮겨짐은 채널 이름 등 보이는 것이 바뀐다(멈춤 갱신과 같은 동기 흐름이면 한 번으로 묶인다)
  if (moved) await playerEvents.refresh(player);
}

// 사람이 자리에 있던 봇을 옮기면 24/7 자리도 따라간다(스테이지는 자리로 받지 않아 자리는 그대로, 봇은 거기서 평소처럼).
// 억제 사유를 맞추기 전에 부른다(혼자 남음 타이머가 옮겨진 채널을 자리로 보게). 되돌림을 고쳤으면 고친 뒤의 채널이다
function followSeat(player: Player, fromId: string | null) {
  const seat = staySeats.seatOf(player.guild.id);
  const to = player.voiceChannel;
  if (!seat || !to || seat.channelId !== fromId || to.id === fromId) return;
  if (to.type !== ChannelType.GuildStageVoice) staySeats.set(player.guild.id, to.id);
  player.idle.reconsider();
}

// 봇 자신의 음성 상태(빠짐 · 옮겨짐)는 음성 연결이 구분한다. 플레이어의 채널을 고치므로 억제 사유를 맞추기보다 먼저 부른다
function botChange(client: Client, player: Player, oldState: VoiceState, newState: VoiceState) {
  const botId = oldState.guild.members.me?.id ?? client.user?.id;
  if (oldState.id !== botId && newState.id !== botId) return { left: false, moved: false };
  return player.voice.onBotState(oldState, newState);
}

export { onVoiceStateUpdate };
