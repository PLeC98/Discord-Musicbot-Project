"use strict";

// 재생 감시 둘. 타이머는 이 모듈이 가지고 stop() 하나로 치운다.
//   종료 감시     곡이 끝났는데 Idle 이 오지 않는 경우. 길이를 넘기면 멈춰 종료 처리에 맡긴다
//   버퍼링 감시   재생이 시작되지 않은 채 입력도 없이 멈춘 경우. 멈춰 같은 곡을 다시 시도하게 한다
// 둘 다 audioPlayer.stop() 으로 Idle 을 일으키고, 왜 멈췄는지(pendingEndReason)를 남긴다.

const { AudioPlayerStatus } = require("@discordjs/voice");
const wlog = require("../infra/log/logger").child({ category: "watchdog" });

const BUFFERING_STALL_MS = 15_000; // 버퍼링 중 입력이 이만큼 없으면 다시 시도

const sec = (ms) => (ms == null ? "?" : (ms / 1000).toFixed(1));

class PlaybackWatch {
  constructor(player) {
    this.player = player;
    this.endTimer = null;
    this.bufferingTimer = null;
    this.bufferingSince = null;
    this._lastLine = null;
  }

  // ── 종료 감시 ──

  /** 이 곡의 종료 감시를 건다. 길이는 스트림이 준 것을 먼저, 없으면 곡의 것 */
  scheduleEnd(streamInfo = null) {
    const player = this.player;
    this.stopEnd();

    const streamDuration = streamInfo && Number(streamInfo.duration) > 0 ? Number(streamInfo.duration) : null;
    const trackDuration = player.currentTrack && Number(player.currentTrack.duration) > 0 ? Number(player.currentTrack.duration) : null;
    const durationSeconds = streamDuration || trackDuration;

    // 라이브는 길이가 없다. 폴백 워치독(5분 뒤 강제 종료)이 방송을 잘라 버린다.
    if (player.currentTrack?.isLive) {
      wlog.debug(`종료 감시 없음: ${player._trackLabel()} | 라이브는 길이로 가를 수 없다`);
      return;
    }

    if (durationSeconds && durationSeconds > 0) {
      // 시작 오프셋을 고려해 남은 시간 계산 (초)
      const startOffsetSeconds = Math.floor((player.currentTrackStartOffsetMs || 0) / 1000);
      const remainingSeconds = Math.max(1, durationSeconds - startOffsetSeconds);

      // 4초 버퍼를 추가하되 최소 5초 타임아웃 보장
      const timeoutMs = Math.max(remainingSeconds * 1000 + 4000, 5000);

      wlog.debug(`종료 감시 예약: ${player._trackLabel()} | 길이 ${durationSeconds}초(${this._durationSource()}) | 오프셋 ${startOffsetSeconds}초 | ${Math.round(timeoutMs / 1000)}초 뒤 확인`);
      this.endTimer = setTimeout(() => this.checkEnd(), timeoutMs);
    } else {
      // 폴백 워치독: 길이를 알 수 없는 스트림은 5분마다 확인
      wlog.warn(`종료 감시 예약: ${player._trackLabel()} | 길이를 몰라 5분 뒤 강제 종료합니다`);
      this.endTimer = setTimeout(() => this.checkEnd(), 5 * 60 * 1000);
    }
  }

  checkEnd() {
    const player = this.player;
    this.endTimer = null;
    if (!player.currentTrack) return;

    // 라이브는 길이가 없어 "다 틀었나"를 길이로 가를 수 없다. 이 감시를 걸지 않는다.
    // 끊김은 버퍼링 정체 감지와 ffmpeg 종료 코드가 잡는다.
    if (player.currentTrack.isLive) return;

    const status = player.audioPlayer.state?.status;
    // playbackDuration은 이 리소스가 낸 양이라 시작 오프셋을 더해야 곡 안의 위치가 된다
    const playedMs = (player.currentTrackStartOffsetMs || 0) + (player.resource?.playbackDuration || 0);
    const playedSec = (playedMs / 1000).toFixed(1);

    if (status === AudioPlayerStatus.Playing) {
      const durationMs = (Number(player.currentTrack.duration) || 0) * 1000;

      if (durationMs > 0 && playedMs + 1500 < durationMs) {
        const remainingMs = Math.max(durationMs - playedMs, 2000);
        wlog.debug(`종료 감시: ${player._trackLabel()} | 재생 ${playedSec}초 / 예상 ${durationMs / 1000}초. 아직 남음, ${Math.round(remainingMs / 1000)}초 뒤 재확인`);
        this.endTimer = setTimeout(() => this.checkEnd(), remainingMs);
        return;
      }

      // 여기서 stop()을 부르면 Idle이 발생해 다음 곡으로 넘어간다. 워치독이 실제로 "일을 한" 유일한 지점.
      wlog.warn(`종료 감시가 트랙을 정지시킴: ${player._trackLabel()} | 재생 ${playedSec}초 / 예상 ${durationMs > 0 ? durationMs / 1000 + "초" : "모름"} | 길이출처=${this._durationSource()}`);

      // Idle을 발생시키고 생명주기 핸들러가 실행되도록 정상 중지
      if (!player.pendingEndReason) {
        player.pendingEndReason = "watchdog";
      }
      player.audioPlayer.stop();
      return;
    }

    if (status === AudioPlayerStatus.Idle || status === AudioPlayerStatus.AutoPaused) {
      // Idle 핸들러가 처리하므로 할 일 없음
      wlog.debug(`종료 감시: ${player._trackLabel()} | 상태=${status}. 종료 처리에 맡기고 감시를 끝냅니다`);
      return;
    }

    // 알 수 없는 상태, 계속 감시 (일시정지 등). 2초마다 도므로 상태가 바뀔 때만 남긴다
    this._logOnce(`👁 워치독 확인: ${player._trackLabel()} | 상태=${status} | 재생 ${playedSec}s → 2s 간격 감시 중`);
    this.endTimer = setTimeout(() => this.checkEnd(), 2000);
  }

  stopEnd() {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  _durationSource() {
    const t = this.player.currentTrack;
    if (!(Number(t?.duration) > 0)) return "없음";
    return t?.durationSource || "제공값";
  }

  // 2초 폴링이 같은 줄을 도배하지 않게, 직전과 다를 때만 남긴다
  _logOnce(line) {
    if (this._lastLine === line) return;
    this._lastLine = line;
    wlog.debug(line);
  }

  // ── 버퍼링 감시 ──

  startBuffering() {
    this.stopBuffering();
    this.bufferingSince = Date.now();
    this.bufferingTimer = setInterval(() => this.checkBufferingStall(), 1000);
    this.bufferingTimer.unref?.();
  }

  // 입력이 조금씩이라도 들어오면 정체가 아니다. Range를 못 쓰는 입력의 위치 재개는 앞부분을 읽어 넘기느라 오래 걸린다
  checkBufferingStall(now = Date.now()) {
    const player = this.player;
    if (player.audioPlayer?.state?.status !== AudioPlayerStatus.Buffering) return this.stopBuffering();
    const quietSince = Math.max(this.bufferingSince ?? now, player.playback?.inputProgressAt ?? 0);
    if (now - quietSince < BUFFERING_STALL_MS) return;
    this.stopBuffering();
    wlog.warn(`재생이 시작되지 않아 다시 시도합니다: ${player._trackLabel()} | 버퍼링 ${sec(now - this.bufferingSince)}초, 입력 없음 ${sec(now - quietSince)}초`);
    if (!player.pendingEndReason) player.pendingEndReason = "buffering-stall";
    // force 없이는 무음 패딩만 예약되고 Buffering에서 벗어나지 않는다(패딩은 Playing에서만 소비된다)
    player.audioPlayer.stop(true);
  }

  stopBuffering() {
    if (this.bufferingTimer) clearInterval(this.bufferingTimer);
    this.bufferingTimer = null;
  }

  /** 두 감시를 모두 치운다 */
  stop() {
    this.stopEnd();
    this.stopBuffering();
  }
}

module.exports = PlaybackWatch;
module.exports.BUFFERING_STALL_MS = BUFFERING_STALL_MS;
