"use strict";

const { VoiceConnectionStatus, joinVoiceChannel, entersState } = require("@discordjs/voice");
const log = require("../infra/log/logger").child({ category: "voice" });
const { holdingAdapterCreator } = require("../infra/voiceAdapter");

const MOVE_BOUNCE_MS = 1500; // 옮겨진 뒤 이만큼 안에 원래 채널로 돌아오면 라이브러리의 되돌림으로 본다
const BOUNCE_FIX_GAP_MS = 10_000; // 되돌려 붙기 사이 최소 간격. 되돌림이 되풀이돼도 핑퐁이 되지 않게

/**
 * VoiceConnectionManager. 음성 연결/자동 복구/헬스체크
 *
 * 복구 상태(복구 중인가 · 몇 번째 시도인가)와 헬스체크 타이머는 이 인스턴스가 가진다. 연결 자체(connection)는
 * 플레이어가 음성 라이브러리에 구독시키므로 플레이어에 있다.
 */
class VoiceConnectionManager {
  constructor(player) {
    this.player = player;
    this.isRecovering = false;
    this.recoveryAttempts = 0;
    this.maxRecoveryAttempts = 5;
    this.healthCheck = null;
    this.lastMove = null; // 마지막으로 옮겨진 것 { from, to, at }
    this.lastBounceFix = null;
  }

  setupConnectionEvents() {
    const player = this.player;
    if (!player.connection) return;

    const label = () => `"${player.voiceChannel?.name ?? player.voiceChannel?.id ?? "?"}" (${player.guild?.name ?? player.guild?.id})`;

    player.connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      // 이미 복구 중이거나 사용자가 봇 연결을 끊은 경우 복구를 트리거하지 않음
      if (this.isRecovering || newState.reason === "Manual disconnect") {
        log.info(`연결 끊김: ${label()} | 사유=${newState.reason ?? "?"} | 복구 안 함 (${this.isRecovering ? "이미 복구 중" : "수동 해제"})`);
        return;
      }

      // 네트워크 연결 끊김에는 즉시 자동 재연결 시도
      log.warn(`연결 끊김: ${label()} | 사유=${newState.reason ?? "?"} | 자동 재연결 대기`);
      try {
        await entersState(player.connection, VoiceConnectionStatus.Connecting, 5000);
        // 여기에 도달하면 Discord가 자동 재연결을 시도 중임
        await entersState(player.connection, VoiceConnectionStatus.Ready, 10000);
        log.info({ tags: ["recovered"] }, `자동 재연결 성공: ${label()}`);
      } catch (error) {
        // 자동 재연결 실패, 음악 재생 중이면 자체 복구 시스템 시작
        const willRecover = !!player.currentTrack && !player.paused;
        log.warn(`자동 재연결 실패: ${label()} | ${willRecover ? "자체 복구 시작" : "재생 중이 아니라 복구 안 함"}`);
        if (willRecover) {
          this.startConnectionRecovery();
        }
      }
    });

    player.connection.on(VoiceConnectionStatus.Destroyed, () => {
      // 음악이 재생 중이고 아직 복구 중이 아닐 때만 복구 시작
      const willRecover = !!player.currentTrack && !player.paused && !this.isRecovering;
      log.info(`음성 연결 종료됨: ${label()}${willRecover ? " | 재생 중이라 복구 시작" : ""}`);
      if (willRecover) {
        this.startConnectionRecovery();
      }
    });

    player.connection.on("error", (error) => {
      log.error("음성 연결 오류:", error);
      if (player.currentTrack && !player.paused) {
        this.startConnectionRecovery();
      }
    });

    // 연결 상태 변경 모니터링. 전이를 남겨야 "언제 왜 끊겼는지"를 사후에 따라갈 수 있다.
    // 다만 정상 연결은 signalling → connecting → ready 로 한 번에 세 줄이고, 그 세 줄로
    // 사후에 밝힐 것이 없다. 이상한 경우는 아래와 error 핸들러가 따로 갈라낸다.
    player.connection.on("stateChange", (oldState, newState) => {
      if (oldState.status !== newState.status) {
        log.debug(`연결 상태: ${oldState.status} → ${newState.status} | ${label()}`);
      }
      if (newState.status === VoiceConnectionStatus.Ready) {
        // 연결 복구 성공
        if (this.isRecovering) {
          log.info({ tags: ["recovered"] }, `연결 복구 완료: ${label()} | 시도 ${this.recoveryAttempts}회`);
          this.stopConnectionRecovery();
        }
        this.recoveryAttempts = 0;
      }
    });
  }

  startConnectionHealthCheck() {
    const player = this.player;

    // 30초마다 연결 상태 확인
    this.stopHealthCheck();
    this.healthCheck = setInterval(async () => {
      try {
        // 연결 상태 확인
        if (!player.connection || player.connection.state.status === VoiceConnectionStatus.Destroyed) {
          if (player.currentTrack && !player.paused && !this.isRecovering) {
            this.startConnectionRecovery();
          }
        }

        // 음성 채널이 아직 존재하는지 확인
        const channelId = player.voiceChannel?.id;
        const channel = channelId ? player.guild.channels.cache.get(channelId) : null;
        if (!channel) {
          // 클라이언트 레지스트리에서도 제거. 정리된 플레이어를
          // 맵에 남겨두면 모든 음악 명령을 막는 잔여 항목이 생김
          // 이 서버는 재시작 전까지 계속 막힘
          log.warn(`헬스체크: 음성 채널을 찾을 수 없어 플레이어를 정리합니다 (${player.guild?.name ?? player.guild?.id})`);
          player.cleanup("헬스체크: 음성 채널을 찾을 수 없음");
          const clientInstance = player.guild?.client;
          if (clientInstance?.players?.get(player.guild.id) === player) {
            clientInstance.players.delete(player.guild.id);
          }
          return;
        }
      } catch (error) {
        log.error("연결 헬스체크 오류:", error);
      }
    }, 30000);
  }

  stopHealthCheck() {
    if (this.healthCheck) clearInterval(this.healthCheck);
    this.healthCheck = null;
  }

  async startConnectionRecovery() {
    const player = this.player;
    if (this.isRecovering) return;

    this.isRecovering = true;
    this.recoveryAttempts = 0;

    log.warn(`연결 복구 시작: "${player.voiceChannel?.name ?? player.voiceChannel?.id ?? "?"}" (${player.guild?.name ?? player.guild?.id}) | 최대 ${this.maxRecoveryAttempts}회`);

    // 단일 실행 복구 루프.
    // "시도 → 완료 대기 → 휴지"를 순차 반복하고, 세대 토큰으로 중단↔재시작 경쟁을 차단
    // (stop 후 새 복구가 시작돼도 이전 루프의 늦은 await 복귀가 새 상태를 건드리지 못함).
    const gen = (this._recoveryGen = (this._recoveryGen || 0) + 1);
    const active = () => this.isRecovering && gen === this._recoveryGen;

    try {
      while (active()) {
        this.recoveryAttempts++;
        if (this.recoveryAttempts > this.maxRecoveryAttempts) {
          log.error(`연결 복구 포기: 최대 시도 ${this.maxRecoveryAttempts}회를 넘었습니다`);
          break;
        }

        try {
          // 음성 채널이 아직 존재하는지 확인
          const channel = player.voiceChannel?.id ? player.guild.channels.cache.get(player.voiceChannel.id) : null;
          if (!channel) {
            log.warn("연결 복구 중단: 음성 채널을 찾을 수 없음");
            break;
          }

          // 재연결 시도. 완료(성공/실패/15초 타임아웃)까지 기다린 뒤에만 다음 단계로
          const reconnected = await this.forceReconnect();
          if (!active()) return; // 대기 중 중단됨. 상태를 건드리지 않고 종료

          if (reconnected) {
            // 재생을 이어 트는 것은 플레이어가 한다. 연결 모듈은 알리기만 한다
            await player.onVoiceRecovered();
            break;
          }
        } catch (error) {
          log.error(`연결 복구 ${this.recoveryAttempts}회차 실패:`, error);
        }

        // 다음 시도까지 휴지 (테스트에서 재정의 가능)
        await new Promise((resolve) => setTimeout(resolve, this.recoveryRetryDelayMs ?? 3000));
      }
    } catch (error) {
      // 호출부가 await하지 않으므로(fire-and-forget) 루프는 절대 reject로 끝나면 안 됨
      log.error("연결 복구 루프 오류:", error);
    } finally {
      if (active()) this.stopConnectionRecovery();
    }
  }

  stopConnectionRecovery() {
    this._recoveryGen = (this._recoveryGen || 0) + 1; // 진행 중인 루프 무효화 (늦은 await 복귀 차단)
    this.isRecovering = false;
    this.recoveryAttempts = 0;
  }

  async forceReconnect() {
    const player = this.player;
    try {
      // 기존 연결 제거. 이미 파괴된 연결에 destroy()를 다시 부르면 예외가 난다.
      // 복구 트리거 자체가 "연결이 Destroyed됨"(헬스체크/Destroyed 이벤트)인 경우가 많으므로
      // 상태를 확인하고, 그래도 남은 경쟁은 try로 삼켜 새 연결 생성으로 넘어간다.
      if (player.connection && player.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        try {
          player.connection.destroy();
        } catch {
          // 이미 파괴됨 등. 무시하고 새 연결로 진행
        }
      }

      // 새 연결 생성
      player.connection = joinVoiceChannel({
        channelId: player.voiceChannel.id,
        guildId: player.guild.id,
        adapterCreator: this._adapterCreator(),
      });

      // 새 연결의 이벤트 설정
      this.setupConnectionEvents();

      // 오디오 플레이어 구독
      player.connection.subscribe(player.audioPlayer);

      // 연결 준비 대기
      await entersState(player.connection, VoiceConnectionStatus.Ready, 15000);
      return true;
    } catch (error) {
      log.error("강제 재연결 실패:", error);
      return false;
    }
  }

  async connect() {
    const player = this.player;
    try {
      // 서버 WebSocket 준비 대기 (샤딩에 중요)
      if (!player.guild.voiceAdapterCreator) {
        // 어댑터 사용 가능 상태를 최대 10초 대기
        const maxWait = 10000;
        const startTime = Date.now();

        while (!player.guild.voiceAdapterCreator && Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          // 상태 갱신을 위해 서버 다시 가져오기 시도
          if (player.guild.client) {
            try {
              const freshGuild = await player.guild.client.guilds.fetch(player.guild.id);
              if (freshGuild && freshGuild.voiceAdapterCreator) {
                // 서버 참조 갱신. 캐시된 Guild 인스턴스를 직접 변조(Object.assign)하지 않고
                // 신선 참조로 재할당. fetch()는 캐시된 동일 인스턴스를 갱신해 돌려주므로
                // 재할당이 안전하고, 공유 객체의 내부 상태를 덮어쓸 위험이 없다.
                player.guild = freshGuild;
                break;
              }
            } catch (e) {
              // 가져오기 오류 무시
            }
          }
        }

        if (!player.guild.voiceAdapterCreator) {
          throw new Error("Guild voice adapter not ready after waiting");
        }
      }

      player.connection = joinVoiceChannel({
        channelId: player.voiceChannel.id,
        guildId: player.guild.id,
        adapterCreator: this._adapterCreator(),
      });

      // 연결 이벤트 설정
      this.setupConnectionEvents();

      player.connection.subscribe(player.audioPlayer);

      // 연결 준비 대기
      await entersState(player.connection, VoiceConnectionStatus.Ready, 30000);
      log.info(`음성 채널 참가: "${player.voiceChannel?.name ?? player.voiceChannel?.id}" (${player.guild?.name ?? player.guild?.id})`);
      return true;
    } catch (error) {
      log.error("음성 채널 연결 실패:", error.message);
      throw error; // restoreFromState가 처리할 수 있도록 다시 던짐
    }
  }

  // 옮겨질 때 옛 채널로 다시 참가하지 않게 참가 요청을 잠깐 붙잡는 어댑터(infra/voiceAdapter)
  _adapterCreator() {
    const player = this.player;
    return holdingAdapterCreator(player.guild.voiceAdapterCreator, {
      onRewrite: (from, to) => log.info(`음성 재참가 요청을 옮겨진 채널로 고쳐 보냅니다: ${from} → ${to} (${player.guild?.name ?? player.guild?.id})`),
    });
  }

  /**
   * 누가 봇을 다른 채널로 옮겼다(음성 상태 이벤트). 음성 라이브러리는 상태 패킷으로 목적지를 따라가므로
   * 다시 붙지 않고 기록만 맞춘다. 이벤트마다 다시 붙으면 그 다시 붙기가 또 이벤트를 만들어 채널 사이를 오간다.
   *
   * 다만 라이브러리에 경쟁이 있다. 옮겨지는 순간 음성 서버 연결이 상태 패킷보다 먼저 닫히면 옛 설정으로
   * 다시 참가해 원래 채널로 되돌아간다(@discordjs/voice onNetworkingClose). 방금 옮겨진 곳에서 곧바로
   * 원래 채널로 돌아오면 그 되돌림으로 보고 목적지로 한 번 다시 붙는다. 되돌려 붙기는 드물게만 한다.
   * @returns {boolean} 되돌려 붙었나
   */
  followMove(fromId, toChannel, now = Date.now()) {
    const player = this.player;
    const where = player.guild?.name ?? player.guild?.id;
    const target = this._bouncedFrom(fromId, toChannel, now);
    if (target) {
      this.lastBounceFix = now;
      this.lastMove = null;
      player.voiceChannel = target;
      log.warn(`음성 채널이 옮겨진 직후 원래 채널로 되돌아와 다시 옮깁니다: "${target.name ?? target.id}" (${where})`);
      player.connection.rejoin({ channelId: target.id, selfDeaf: false, selfMute: false });
      return true;
    }
    this.lastMove = { from: fromId, to: toChannel.id, at: now };
    player.voiceChannel = toChannel;
    log.info(`음성 채널 이동: "${toChannel.name ?? toChannel.id}" (${where})`);
    return false;
  }

  // 방금 옮겨진 곳에서 곧바로 원래 채널로 되돌아왔으면 다시 붙을 목적지. 아니면(또는 막 되돌려 붙었으면) null
  _bouncedFrom(fromId, toChannel, now) {
    const last = this.lastMove;
    if (!last || now - last.at >= MOVE_BOUNCE_MS || last.from !== toChannel.id || last.to !== fromId) return null;
    if (!this.player.connection || now - (this.lastBounceFix ?? -Infinity) < BOUNCE_FIX_GAP_MS) return null;
    return this.player.guild.channels.cache.get(last.to) ?? null;
  }

  // 연결을 부수고 비운다. 리스너를 먼저 떼어 부서지는 연결이 복구를 부르지 않게 한다.
  // 여기서 나가는 경우가 무음이면 "왜 나갔는지"를 사후에 알 수 없다. 원인을 남긴다
  disconnect(reason = "정리") {
    const player = this.player;
    const connection = player.connection;
    player.connection = null;
    if (!connection) return;
    connection.removeAllListeners();
    if (connection.state?.status === "destroyed") return;
    try {
      connection.destroy();
      log.info(`음성 채널 떠남: "${player.voiceChannel?.name ?? player.voiceChannel?.id ?? "?"}" (${player.guild?.name ?? player.guild?.id}) | 원인=${reason}`);
    } catch (error) {
      log.error("음성 연결 종료 실패:", error);
    }
  }
}

module.exports = VoiceConnectionManager;
