// 재생 감시 셋. 타이머는 이 모듈이 가지고 stop() 하나로 치운다.
//   넘침 안전망   음원 길이를 아는 곡의 위치가 길이를 한참 넘기면 멈춰 다음 곡으로 넘긴다. 끝을 알리지 못하는 입력의 마지막 그물
//   버퍼링 감시   재생이 시작되지 않은 채 입력도 없이 멈춘 경우. 멈춰 같은 곡을 다시 시도하게 한다
//   멎음 감시     오디오가 Idle 이 됐는데 곡 끝 처리가 곡을 넘기지 못한 경우. 다음 곡으로 넘긴다
// 곡이 끝났는지는 여기서 가르지 않는다. Idle 때 입력 쪽 사실로 가른다(rules/endVerdict).

import { AudioPlayerStatus } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const wlog = logger.child({ category: "watchdog" });
import { knownLengthMs } from "../rules/endVerdict.ts";
import type { Player } from "./Player.ts";

/** 감시가 읽고 멈추는 플레이어 칸 */
type WatchHost = Pick<Player, "_trackLabel" | "audioPlayer" | "currentTrack" | "getCurrentTime" | "isLive" | "_stopWith" | "playback" | "lifecycle" | "isRecovering" | "onTrackEnd">;

const BUFFERING_STALL_MS = 15_000; // 버퍼링 중 입력이 이만큼 없으면 다시 시도
const OVERFLOW_MS = 30_000; // 위치가 길이를 이만큼 넘기면 멈춘다
const OVERFLOW_CHECK_MS = 5_000;
const IDLE_STUCK_MS = 10_000; // Idle 이 된 뒤 곡이 이만큼 넘어가지 않으면 다음 곡으로

const sec = (ms: number | null | undefined) => (ms == null ? "?" : (ms / 1000).toFixed(1));

class PlaybackWatch {
  static BUFFERING_STALL_MS = BUFFERING_STALL_MS;
  static IDLE_STUCK_MS = IDLE_STUCK_MS;
  player: WatchHost;
  overflowTimer: NodeJS.Timeout | null;
  bufferingTimer: NodeJS.Timeout | null;
  bufferingSince: number | null;
  idleTimer: NodeJS.Timeout | null;

  constructor(player: WatchHost) {
    this.player = player;
    this.overflowTimer = null;
    this.bufferingTimer = null;
    this.bufferingSince = null;
    this.idleTimer = null;
  }

  // ── 넘침 안전망 ──

  /** 이 곡의 넘침 안전망을 건다. 위치로 보므로 일시정지 · 버퍼링과 어긋나지 않는다 */
  startOverflow() {
    this.stopOverflow();
    this.overflowTimer = setInterval(() => this.checkOverflow(), OVERFLOW_CHECK_MS);
    this.overflowTimer.unref?.();
  }

  checkOverflow(): void {
    const player = this.player;
    // 길이를 모르거나 믿을 수 없으면(추정값 · 라이브) 넘었는지 가를 수 없다
    const lengthMs = player.currentTrack && !player.isLive ? knownLengthMs(player.currentTrack) : null;
    if (!lengthMs) return;
    const at = player.getCurrentTime();
    if (at <= lengthMs + OVERFLOW_MS) return;
    this.stopOverflow();
    wlog.warn(`곡 길이를 ${OVERFLOW_MS / 1000}초 넘게 지나 멈춥니다: ${player._trackLabel()} | 위치 ${sec(at)}초 / 길이 ${sec(lengthMs)}초`);
    player._stopWith("overflow");
  }

  stopOverflow() {
    if (this.overflowTimer) clearInterval(this.overflowTimer);
    this.overflowTimer = null;
  }

  // ── 버퍼링 감시 ──

  startBuffering() {
    this.stopBuffering();
    this.bufferingSince = Date.now();
    this.bufferingTimer = setInterval(() => this.checkBufferingStall(), 1000);
    this.bufferingTimer.unref?.();
  }

  // 입력이 조금씩이라도 들어오면 정체가 아니다. Range를 못 쓰는 입력의 위치 재개는 앞부분을 읽어 넘기느라 오래 걸린다
  checkBufferingStall(now = Date.now()): void {
    const player = this.player;
    if (player.audioPlayer?.state?.status !== AudioPlayerStatus.Buffering) return this.stopBuffering();
    const quietSince = Math.max(this.bufferingSince ?? now, player.playback?.inputProgressAt ?? 0);
    if (now - quietSince < BUFFERING_STALL_MS) return;
    this.stopBuffering();
    wlog.warn(`재생이 시작되지 않아 다시 시도합니다: ${player._trackLabel()} | 버퍼링 ${sec(now - (this.bufferingSince ?? now))}초, 입력 없음 ${sec(now - quietSince)}초`);
    // force 없이는 무음 패딩만 예약되고 Buffering에서 벗어나지 않는다(패딩은 Playing에서만 소비된다)
    player._stopWith("buffering-stall");
  }

  stopBuffering() {
    if (this.bufferingTimer) clearInterval(this.bufferingTimer);
    this.bufferingTimer = null;
  }

  // ── 멎음 감시 ──

  /** 오디오가 Idle 이 됐다. 정상이면 곡 끝 처리가 곧 다음 곡을 틀거나 곡을 비운다 */
  armIdle() {
    this.stopIdle();
    this.idleTimer = setTimeout(() => this.checkIdle(), IDLE_STUCK_MS);
    this.idleTimer.unref?.();
  }

  checkIdle(): void {
    const player = this.player;
    this.idleTimer = null;
    if (!player.currentTrack || player.audioPlayer.state.status !== AudioPlayerStatus.Idle) return;
    // 곡을 여는 중 · 끝 처리 중 · 음성 복구 중이면 그 일이 끝난 뒤 다시 본다
    if (player.lifecycle.starting || player.lifecycle.ending || player.isRecovering) return this.armIdle();
    wlog.warn(`곡이 있는데 오디오가 ${IDLE_STUCK_MS / 1000}초 넘게 멈춰 있어 곡을 끝냅니다: ${player._trackLabel()}`);
    this.armIdle(); // 넘긴 곡도 틀지 못하면 다시 본다
    player.onTrackEnd("stuck").catch((error) => wlog.error("멎은 곡 넘기기 실패:", error));
  }

  stopIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** 감시를 모두 치운다 */
  stop() {
    this.stopOverflow();
    this.stopBuffering();
    this.stopIdle();
  }
}

export { PlaybackWatch };
export type { WatchHost };
