// 언제 음성 채널을 떠나나. 타이머 둘을 이 모듈이 가지고 stop() 하나로 치운다.
//   혼자 남음   채널에 사람이 없으면 멈추고, 정해진 시간 뒤에도 없으면 정리한다(leaveDelayAloneMs)
//   틀 게 없음  대기열이 비면 정해진 시간 뒤 정리한다(leaveDelayQueueEmptyMs)
// 누가 혼자 남았는지 알아보는 것(음성 상태 해석)은 부르는 쪽이 한다. 여기는 시간만 잰다.
// 곡이 없을 때 사람이 나가거나 돌아와 나갈 시각이 바뀌면 알린다(끝난 패널의 "쉬러 갈게요").

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../../config.ts";
import * as trackState from "./trackState.ts";
import * as playerEvents from "./events.ts";
import type { MusicPlayer } from "./Player.ts";
import { bestEffort } from "../infra/bestEffort.ts";

class IdleLeave {
  player: MusicPlayer;
  aloneTimer: NodeJS.Timeout | null;
  emptyTimer: NodeJS.Timeout | null;
  aloneMs: number;
  // 타이머마다 나갈 시각. 걸려 있지 않으면 null
  aloneAt: number | null = null;
  emptyAt: number | null = null;

  // 알림(events)에 플레이어를 넘기므로 플레이어 그대로 받는다
  constructor(player: MusicPlayer) {
    this.player = player;
    this.aloneTimer = null;
    this.emptyTimer = null;
    this.aloneMs = config.bot.leaveDelayAloneMs;
  }

  // ── 혼자 남음 ──

  startAlone() {
    const player = this.player;
    if (this.aloneTimer) return;

    log.info(`서버 ${player.guild?.name ?? player.guild?.id}의 채널 ${player.voiceChannel?.name ?? player.voiceChannel?.id}에 사람이 없습니다. ${Math.round(this.aloneMs / 1000)}초 뒤 정리합니다`);
    player.pauseFor("alone");

    this.aloneAt = Date.now() + Math.max(this.aloneMs, 0);
    this.aloneTimer = setTimeout(
      async () => {
        this.aloneTimer = null;
        this.aloneAt = null;

        const channelId = player.voiceChannel?.id;
        const channel = channelId ? player.guild.channels.cache.get(channelId) : null;
        const hasListeners = channel?.isVoiceBased() ? channel.members.filter((member) => !member.user.bot).size > 0 : false;

        if (hasListeners) {
          player.resumeFor("alone");
          await playerEvents.refresh(player);
          return;
        }

        player.pauseReasons.clear();
        player.pendingEndReason = "inactivity-timeout";
        trackState.reset(player);

        try {
          await playerEvents.ended(player, "disconnected");

          await player.persistState("inactivity-timeout");
        } catch (error) {
          log.error("비활성 정리 후 재생 UI 갱신 실패:", error);
        } finally {
          // 교체된 뒤 남은 타이머가 현행 플레이어의 연결을 끊지 않도록 (대기열 소진 타이머와 같은 사고)
          if (!player._isActivePlayer()) {
            log.info(`밀려난 플레이어의 비활성 타이머. 자기 자원만 정리합니다 (${player.guild?.name ?? player.guild?.id})`);
            player.releaseResources();
            player.releaseAudioProtection();
          } else {
            try {
              player.cleanup("비활성 타임아웃");
            } finally {
              player.guild?.client?.players?.delete(player.guild.id);
            }
          }
        }
      },
      Math.max(this.aloneMs, 0),
    );
    this.announce();
  }

  /** 혼자 남음 타이머를 거둔다. shouldResume 이면 "혼자" 멈춤도 풀고, 아니면 그 사유만 지운다(재생은 그대로) */
  cancelAlone(shouldResume = true) {
    const player = this.player;
    if (this.aloneTimer) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
      this.aloneAt = null;
      // 사람이 돌아와 거둔 것만 알린다. 대기열이 끝나 거두는 쪽(shouldResume 이 거짓)은 곧 끝난 패널을 새로 그린다
      if (shouldResume) this.announce();
      // 여기가 "정리 예약이 취소된다"는 상태 변화가 실제로 일어나는 지점이다.
      // 예약을 건 타이머 콜백 안에도 같은 로그가 있었는데, 사람이 돌아오면 음성 상태 이벤트가
      // 이 함수를 먼저 불러 타이머를 지우므로 그 콜백은 아예 실행되지 않았다. 거의 안 찍혔다.
      if (shouldResume) log.info(`서버 ${player.guild?.name ?? player.guild?.id}의 채널 ${player.voiceChannel?.name ?? player.voiceChannel?.id}에 사람이 복귀하여 정리를 취소합니다`);
    }

    if (shouldResume) {
      player.resumeFor("alone");
    } else {
      player.pauseReasons.delete("alone");
    }
  }

  // ── 틀 게 없음 ──

  scheduleEmpty(reason = "대기열 소진") {
    const player = this.player;
    this.cancelEmpty();
    this.emptyAt = Date.now() + config.bot.leaveDelayQueueEmptyMs;
    this.emptyTimer = setTimeout(() => {
      this.emptyTimer = null;
      this.emptyAt = null;
      if (player.queue.length !== 0 || player.currentTrack) return;
      if (!player._isActivePlayer()) {
        log.info(`밀려난 플레이어의 대기열 소진 타이머. 자기 자원만 정리합니다 (${player.guild?.name ?? player.guild?.id})`);
        player.releaseResources();
        player.releaseAudioProtection();
        return;
      }
      player.cleanup(reason);
      player.guild.client.players.delete(player.guild.id);
      // 끝난 패널의 "쉬러 갈게요"를 음성 밖 문구로
      bestEffort(log, playerEvents.ended(player, "disconnected"), "끝난 패널 고치기");
    }, config.bot.leaveDelayQueueEmptyMs);
  }

  cancelEmpty() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.emptyAt = null;
  }

  /** 곡이 없을 때 나갈 시각. 걸린 타이머 중 먼저 끝나는 쪽, 없으면 null */
  leavesAt() {
    const times = [this.aloneAt, this.emptyAt].filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  }

  // 곡이 없을 때만. 재생 중이면 패널이 나갈 시각을 보이지 않는다
  announce() {
    if (this.player.currentTrack) return;
    bestEffort(log, playerEvents.leaving(this.player, this.leavesAt()), "끝난 패널의 나갈 시각 고치기");
  }

  /** 두 타이머를 모두 거둔다. "혼자" 멈춤 사유도 지운다(플레이어를 버릴 때) */
  stop() {
    this.cancelAlone(false);
    this.cancelEmpty();
  }
}

export { IdleLeave };
