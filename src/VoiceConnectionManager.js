"use strict";

const { VoiceConnectionStatus, joinVoiceChannel, entersState } = require("@discordjs/voice");

/**
 * VoiceConnectionManager — 음성 연결/자동 복구/헬스체크
 *
 * 연결 상태 필드(connection, isRecovering, recoveryAttempts, recoveryInterval, connectionHealthCheck 등)는 기존 외부 참조와 cleanup/releaseResources의 직접 해제를 깨지 않도록 player 인스턴스에 유지하고, 이 클래스는 로직만 보유
 */
class VoiceConnectionManager {
  constructor(player) {
    this.player = player;
  }

  setupConnectionEvents() {
    const player = this.player;
    if (!player.connection) return;

    player.connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      // 이미 복구 중이거나 사용자가 봇 연결을 끊은 경우 복구를 트리거하지 않음
      if (player.isRecovering || newState.reason === "Manual disconnect") {
        return;
      }

      // 네트워크 연결 끊김에는 즉시 자동 재연결 시도
      try {
        await entersState(player.connection, VoiceConnectionStatus.Connecting, 5000);
        // 여기에 도달하면 Discord가 자동 재연결을 시도 중임
        await entersState(player.connection, VoiceConnectionStatus.Ready, 10000);
      } catch (error) {
        // 자동 재연결 실패, 음악 재생 중이면 자체 복구 시스템 시작
        if (player.currentTrack && !player.paused) {
          this.startConnectionRecovery();
        }
      }
    });

    player.connection.on(VoiceConnectionStatus.Destroyed, () => {
      // 음악이 재생 중이고 아직 복구 중이 아닐 때만 복구 시작
      if (player.currentTrack && !player.paused && !player.isRecovering) {
        this.startConnectionRecovery();
      }
    });

    player.connection.on("error", (error) => {
      console.error("🚨 Voice connection error:", error);
      if (player.currentTrack && !player.paused) {
        this.startConnectionRecovery();
      }
    });

    // 연결 상태 변경 모니터링
    player.connection.on("stateChange", (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Ready) {
        // 연결 복구 성공
        if (player.isRecovering) {
          this.stopConnectionRecovery();
        }
        player.recoveryAttempts = 0;
      }
    });
  }

  startConnectionHealthCheck() {
    const player = this.player;

    // 30초마다 연결 상태 확인
    player.connectionHealthCheck = setInterval(async () => {
      try {
        // 연결 상태 확인
        if (!player.connection || player.connection.state.status === VoiceConnectionStatus.Destroyed) {
          if (player.currentTrack && !player.paused && !player.isRecovering) {
            this.startConnectionRecovery();
          }
        }

        // 음성 채널이 아직 존재하는지 확인
        const channelId = player.voiceChannel?.id;
        const channel = channelId ? player.guild.channels.cache.get(channelId) : null;
        if (!channel) {
          // 클라이언트 레지스트리에서도 제거 — 정리된 플레이어를
          // 맵에 남겨두면 모든 음악 명령을 막는 잔여 항목이 생김
          // 이 길드는 재시작 전까지 계속 막힘
          player.cleanup();
          const clientInstance = player.guild?.client;
          if (clientInstance?.players?.get(player.guild.id) === player) {
            clientInstance.players.delete(player.guild.id);
          }
          return;
        }
      } catch (error) {
        console.error("❌ Health check error:", error);
      }
    }, 30000);
  }

  async startConnectionRecovery() {
    const player = this.player;
    if (player.isRecovering) return;

    player.isRecovering = true;
    player.recoveryAttempts = 0;

    // 현재 재생 위치 저장
    this.savePlaybackPosition();

    // 단일 실행 복구 루프. 구 setInterval(3초) 방식은 forceReconnect가 Ready를 최대 15초
    // 기다리는 동안 다음 콜백이 겹쳐 서로의 새 연결을 destroy하는 경쟁이 있었다(감사 M-04).
    // "시도 → 완료 대기 → 휴지"를 순차 반복하고, 세대 토큰으로 중단↔재시작 경쟁을 차단한다
    // (stop 후 새 복구가 시작돼도 이전 루프의 늦은 await 복귀가 새 상태를 건드리지 못함).
    const gen = (this._recoveryGen = (this._recoveryGen || 0) + 1);
    const active = () => player.isRecovering && gen === this._recoveryGen;

    try {
      while (active()) {
        player.recoveryAttempts++;
        if (player.recoveryAttempts > player.maxRecoveryAttempts) break;

        try {
          // 음성 채널이 아직 존재하는지 확인
          const channel = player.voiceChannel?.id ? player.guild.channels.cache.get(player.voiceChannel.id) : null;
          if (!channel) break;

          // 재연결 시도 — 완료(성공/실패/15초 타임아웃)까지 기다린 뒤에만 다음 단계로
          const reconnected = await this.forceReconnect();
          if (!active()) return; // 대기 중 중단됨 — 상태를 건드리지 않고 종료

          if (reconnected) {
            // 중단된 위치에서 재생 재개
            await this.resumePlaybackAfterRecovery();
            break;
          }
        } catch (error) {
          console.error(`❌ Recovery attempt ${player.recoveryAttempts} failed:`, error);
        }

        // 다음 시도까지 휴지 (테스트에서 재정의 가능)
        await new Promise((resolve) => setTimeout(resolve, this.recoveryRetryDelayMs ?? 3000));
      }
    } catch (error) {
      // 호출부가 await하지 않으므로(fire-and-forget) 루프는 절대 reject로 끝나면 안 됨
      console.error("❌ Connection recovery loop error:", error);
    } finally {
      if (active()) this.stopConnectionRecovery();
    }
  }

  stopConnectionRecovery() {
    const player = this.player;
    this._recoveryGen = (this._recoveryGen || 0) + 1; // 진행 중인 루프 무효화 (늦은 await 복귀 차단)
    if (player.recoveryInterval) {
      // 구 setInterval 경로의 잔재 방어 — 현재 코드는 인터벌을 만들지 않음
      clearInterval(player.recoveryInterval);
      player.recoveryInterval = null;
    }
    player.isRecovering = false;
    player.recoveryAttempts = 0;
  }

  savePlaybackPosition() {
    const player = this.player;
    if (player.startTime && !player.paused) {
      const elapsedMs = Date.now() - player.startTime + player.pausedTime;
      const totalMs = player.currentTrackStartOffsetMs + elapsedMs;
      player.lastPlaybackPosition = totalMs;
    }
  }

  async forceReconnect() {
    const player = this.player;
    try {
      // 기존 연결 제거 — 이미 파괴된 연결에 destroy()를 다시 부르면 예외가 난다.
      // 복구 트리거 자체가 "연결이 Destroyed됨"(헬스체크/Destroyed 이벤트)인 경우가 많으므로
      // 상태를 확인하고, 그래도 남은 경쟁은 try로 삼켜 새 연결 생성으로 넘어간다.
      if (player.connection && player.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        try {
          player.connection.destroy();
        } catch {
          // 이미 파괴됨 등 — 무시하고 새 연결로 진행
        }
      }

      // 새 연결 생성
      player.connection = joinVoiceChannel({
        channelId: player.voiceChannel.id,
        guildId: player.guild.id,
        adapterCreator: player.guild.voiceAdapterCreator,
      });

      // 새 연결의 이벤트 설정
      this.setupConnectionEvents();

      // 오디오 플레이어 구독
      player.connection.subscribe(player.audioPlayer);

      // 연결 준비 대기
      await entersState(player.connection, VoiceConnectionStatus.Ready, 15000);
      return true;
    } catch (error) {
      console.error("❌ Force reconnect failed:", error);
      return false;
    }
  }

  async resumePlaybackAfterRecovery() {
    const player = this.player;
    if (!player.currentTrack) return;

    try {
      const resumeMs = player.resource ? player.currentTrackStartOffsetMs + (player.resource.playbackDuration || 0) : player.lastPlaybackPosition || 0;
      await player.play(null, resumeMs);
    } catch (error) {
      console.error("❌ Failed to resume playback:", error);
      // 다음 트랙으로 계속 진행 시도
      await player.handleTrackEnd("error");
    }
  }

  async connect() {
    const player = this.player;
    try {
      // 길드 WebSocket 준비 대기 (샤딩에 중요)
      if (!player.guild.voiceAdapterCreator) {
        // 어댑터 사용 가능 상태를 최대 10초 대기
        const maxWait = 10000;
        const startTime = Date.now();

        while (!player.guild.voiceAdapterCreator && Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          // 상태 갱신을 위해 길드 다시 가져오기 시도
          if (player.guild.client) {
            try {
              const freshGuild = await player.guild.client.guilds.fetch(player.guild.id);
              if (freshGuild && freshGuild.voiceAdapterCreator) {
                // 길드 참조 갱신 — 캐시된 Guild 인스턴스를 직접 변조(Object.assign)하지 않고
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
        adapterCreator: player.guild.voiceAdapterCreator,
      });

      // 연결 이벤트 설정
      this.setupConnectionEvents();

      player.connection.subscribe(player.audioPlayer);

      // 연결 준비 대기
      await entersState(player.connection, VoiceConnectionStatus.Ready, 30000);
      return true;
    } catch (error) {
      console.error("❌ Failed to connect to voice channel:", error.message);
      throw error; // restoreFromState가 처리할 수 있도록 다시 던짐
    }
  }

  async moveToChannel(newChannel) {
    const player = this.player;
    if (!newChannel) return false;

    player.voiceChannel = newChannel;

    if (player.connection) {
      try {
        player.connection.rejoin({
          channelId: newChannel.id,
          selfDeaf: false,
          selfMute: false,
        });

        await entersState(player.connection, VoiceConnectionStatus.Ready, 15000);
        return true;
      } catch (error) {
        console.error("❌ Failed to rejoin new voice channel:", error);
        try {
          player.connection.destroy();
        } catch (destroyError) {
          console.error("❌ Error destroying old connection:", destroyError);
        }
        player.connection = null;
      }
    }

    return await this.connect();
  }

  disconnect() {
    const player = this.player;
    if (player.connection && player.connection.state && player.connection.state.status !== "destroyed") {
      try {
        player.connection.destroy();
      } catch (error) {}
    }
    player.connection = null;
  }
}

module.exports = VoiceConnectionManager;
