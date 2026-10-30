// 언제 음성 채널을 떠나나. 타이머 둘을 이 모듈이 가지고 stop() 하나로 치운다.
//   혼자 남음   듣는 사람이 없으면 정해진 시간 뒤에도 없을 때 정리한다(leaveDelayAloneMs). 멈추는 것은 플레이어의 억제 사유(alone)다
//   틀 게 없음  대기열이 비면 정해진 시간 뒤 정리한다(leaveDelayQueueEmptyMs)
// 누가 혼자 남았는지 알아보는 것(음성 상태 해석)은 플레이어의 syncHolds 가 한다. 여기는 시간만 잰다.
// 곡이 없을 때 사람이 나가거나 돌아와 나갈 시각이 바뀌면 알린다(끝난 패널의 "쉬러 갈게요").

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../config/index.ts";
import * as playerEvents from "./events.ts";
import type { Player } from "./player.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { listenersIn } from "../rules/holds.ts";

class IdleLeave {
  player: Player;
  aloneTimer: NodeJS.Timeout | null;
  emptyTimer: NodeJS.Timeout | null;
  aloneMs: number;
  // 타이머마다 나갈 시각. 걸려 있지 않으면 null
  aloneAt: number | null = null;
  emptyAt: number | null = null;

  // 알림(events)에 플레이어를 넘기므로 플레이어 그대로 받는다
  constructor(player: Player) {
    this.player = player;
    this.aloneTimer = null;
    this.emptyTimer = null;
    this.aloneMs = config.bot.leaveDelayAloneMs;
  }

  // ── 혼자 남음 ──
  // 타이머는 "듣는 사람이 없다"(억제 사유 alone)만 따른다. 사유는 플레이어가 지금 음성 상태에서 계산하고(syncHolds), 바뀌면 여기로 넘긴다.
  // 대기열과는 상관없다(대기열이 끝나도 타이머를 지우지 않는다. 채널 밖에서 곡을 추가하면 사유가 남은 채 소리 없이 남지 않게).

  /** 듣는 사람이 없어졌다(true) · 돌아왔다(false) */
  onAlone(alone: boolean) {
    if (alone) this._startAlone();
    else this._endAlone();
  }

  /** 옮겨진 채널에서도 혼자다. 새 채널 기준으로 다시 잰다 */
  restartAlone() {
    this._clearAlone();
    this._startAlone();
  }

  _startAlone() {
    const player = this.player;
    if (this.aloneTimer) return;
    log.info(`서버 ${player.guild?.name ?? player.guild?.id}의 채널 ${player.voiceChannel?.name ?? player.voiceChannel?.id ?? "없음"}에 사람이 없습니다. ${Math.round(this.aloneMs / 1000)}초 뒤 정리합니다`);
    this.aloneAt = Date.now() + Math.max(this.aloneMs, 0);
    this.aloneTimer = setTimeout(
      () => {
        this._aloneExpired().catch((error: unknown) => log.error("빈 음성 채널 자동 퇴장 정리 실패:", error));
      },
      Math.max(this.aloneMs, 0),
    );
    this.announce();
  }

  // 사람이 돌아왔다. 타이머가 돌고 있었을 때만 알린다(대기열이 끝난 뒤 지운 타이머 등은 알릴 것이 없다)
  _endAlone() {
    const player = this.player;
    if (!this._clearAlone()) return;
    log.info(`서버 ${player.guild?.name ?? player.guild?.id}의 채널 ${player.voiceChannel?.name ?? player.voiceChannel?.id ?? "없음"}에 사람이 복귀하여 정리를 취소합니다`);
    this.announce();
  }

  // 타이머를 지운다. 돌고 있었으면 true
  _clearAlone() {
    if (!this.aloneTimer) return false;
    clearTimeout(this.aloneTimer);
    this.aloneTimer = null;
    this.aloneAt = null;
    return true;
  }

  // 혼자 남은 채 기다린 시간이 지났다. 놓친 이벤트가 있을 수 있으니 한 번 더 맞추고, 그래도 아무도 없으면 나간다
  async _aloneExpired() {
    const player = this.player;
    this.aloneTimer = null;
    this.aloneAt = null;
    player.syncHolds();
    // 붙어 있지 않아 맞추지 못했을 수 있다(재연결 중). 그때는 플레이어의 채널을 직접 센다
    const channelId = player.voiceChannel?.id;
    const channel = channelId ? player.guild.channels.cache.get(channelId) : null;
    const listeners = channel?.isVoiceBased() ? listenersIn(channel.members.values()) : 0;
    if (listeners > 0) return; // 사유 · 패널은 syncHolds 가 풀었다

    // 이미 버려진(교체된) 플레이어면 dispose 가 아무것도 하지 않는다. 실패로 멈춰 둔 곡이면 세션을 남긴다(사람이 고른 끝이 아니다. /join 이 이어 튼다)
    await player.dispose({ reason: "비활성 타임아웃", session: player.lifecycle.parked ? "save" : "remove", panel: "disconnected", end: "inactivity-timeout" });
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
      // 끝난 패널의 "쉬러 갈게요"를 음성 밖 문구로
      bestEffort(log, player.dispose({ reason, session: "remove", panel: "disconnected", end: "queue-drained" }), "대기열 소진으로 나가기");
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

  /** 곡 없이 기다리는 끝난 패널에 보일 나갈 시각. 패널을 타이머보다 먼저 그리므로 틀 게 없음 타이머가 아직 없으면 걸 시각으로 센다 */
  upcomingLeave() {
    const ms = config.bot.leaveDelayQueueEmptyMs;
    const empty = this.emptyAt ?? (ms > 0 ? Date.now() + ms : null);
    const times = [this.aloneAt, empty].filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  }

  // 곡이 없을 때만. 재생 중이면 패널이 나갈 시각을 보이지 않는다
  announce() {
    if (this.player.currentTrack) return;
    bestEffort(log, playerEvents.leaving(this.player, this.leavesAt()), "끝난 패널의 나갈 시각 고치기");
  }

  /** 두 타이머를 모두 지운다(플레이어를 버릴 때). 알리지 않는다 */
  stop() {
    this._clearAlone();
    this.cancelEmpty();
  }
}

export { IdleLeave };
