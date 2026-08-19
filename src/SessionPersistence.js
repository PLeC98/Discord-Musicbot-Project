"use strict";

const path = require("path");
const fsSync = require("fs");
const CacheManager = require("./CacheManager");
const { formatDuration } = require("./utils");

/**
 * SessionPersistence — 플레이어 상태의 직렬화/복원/주기 저장
 * 타이머 필드(stateSyncInterval, stateSaveTimeout)는 기존 cleanup 경로를 깨지 않도록 player 인스턴스에 유지.
 */
class SessionPersistence {
  constructor(player) {
    this.player = player;
  }

  serializeTrack(track) {
    if (!track) return null;

    const requester = track.requestedBy || null;
    const requesterId = requester?.id || track.requesterId || null;
    const requesterTag = requester?.tag || requester?.user?.tag || track.requesterTag || null;

    return {
      id: track.id || null,
      title: track.title || null,
      url: track.url || null,
      duration: typeof track.duration === "number" ? track.duration : Number(track.duration) || null,
      thumbnail: track.thumbnail || null,
      artist: track.artist || null,
      album: track.album || null,
      platform: track.platform || null,
      uploader: track.uploader || null,
      youtubeUrl: track.youtubeUrl || null,
      soundcloudUrl: track.soundcloudUrl || null,
      spotifyUrl: track.spotifyUrl || null,
      isLive: track.isLive || track.live || false,
      addedAt: track.addedAt || Date.now(),
      requesterId,
      requesterTag,
      extra: track.extra || null,
    };
  }

  deserializeTrack(data) {
    if (!data) return null;

    const track = {
      id: data.id || null,
      title: data.title || null,
      url: data.url || null,
      duration: typeof data.duration === "number" ? data.duration : Number(data.duration) || null,
      thumbnail: data.thumbnail || null,
      artist: data.artist || null,
      album: data.album || null,
      platform: data.platform || null,
      uploader: data.uploader || null,
      youtubeUrl: data.youtubeUrl || null,
      soundcloudUrl: data.soundcloudUrl || null,
      spotifyUrl: data.spotifyUrl || null,
      isLive: Boolean(data.isLive),
      addedAt: data.addedAt || Date.now(),
      extra: data.extra || null,
    };

    if (data.requesterId) {
      const cachedMember = this.player.guild?.members?.cache?.get?.(data.requesterId) || null;
      track.requestedBy = cachedMember || { id: data.requesterId, tag: data.requesterTag || data.requesterId };
      track.requesterId = data.requesterId;
      track.requesterTag = data.requesterTag || null;
    }

    return track;
  }

  serializeState() {
    const player = this.player;
    const guildId = player.guild?.id;
    if (!guildId) return null;

    return {
      guildId,
      voiceChannelId: player.voiceChannel?.id || null,
      textChannelId: player.textChannel?.id || null,
      currentTrack: this.serializeTrack(player.currentTrack),
      queue: player.queue.map((track) => this.serializeTrack(track)).filter(Boolean),
      previousTracks: player.previousTracks
        .slice(-10)
        .map((track) => this.serializeTrack(track))
        .filter(Boolean),
      volume: player.volume,
      loop: player.loop,
      shuffle: player.shuffle,
      autoplay: player.autoplay,
      paused: player.paused,
      pauseReasons: Array.from(player.pauseReasons || []),
      playbackPositionMs: player.getCurrentTime() || 0,
      currentTrackStartOffsetMs: player.currentTrackStartOffsetMs || 0,
      lastPlaybackPosition: player.lastPlaybackPosition || 0,
      requesterId: player.requesterId || null,
      nowPlayingMessageId: player.nowPlayingMessage?.id || null,
      nowPlayingChannelId: player.nowPlayingMessage?.channelId || player.textChannel?.id || null,
      sessionId: player.sessionId,
      downloadedFiles: Array.from(player.downloadedFiles || [])
        .filter(Boolean)
        .map((filepath) => path.resolve(filepath)),
      currentDownloadedFile: player.currentDownloadedFile ? path.resolve(player.currentDownloadedFile) : null,
      updatedAt: Date.now(),
    };
  }

  async restoreFromState(state) {
    const player = this.player;
    if (!state || !player.guild?.id) return;
    this.stopStateSync();
    player.pauseReasons = new Set();
    player.preloadedStreams.clear();
    player.preloadingQueue = [];

    player.volume = typeof state.volume === "number" ? state.volume : player.volume;
    player.loop = state.loop ?? false;
    player.shuffle = state.shuffle ?? false;
    player.autoplay = state.autoplay ?? false;
    player.requesterId = state.requesterId || player.requesterId;

    player.previousTracks = (state.previousTracks || []).map((serialized) => this.deserializeTrack(serialized)).filter(Boolean);

    const restoredQueue = (state.queue || []).map((serialized) => this.deserializeTrack(serialized)).filter(Boolean);

    player.queue = restoredQueue;
    player.currentTrack = this.deserializeTrack(state.currentTrack) || null;

    if (!player.currentTrack && player.queue.length > 0) {
      player.currentTrack = player.queue.shift();
    }

    const cacheDir = CacheManager._cacheDir;
    const validDownloads = new Set();
    for (const file of state.downloadedFiles || []) {
      if (!file) continue;
      try {
        // 상대 경로를 캐시 디렉터리 기준으로 해석
        const fullPath = path.isAbsolute(file) ? file : path.join(cacheDir, file);
        if (fsSync.existsSync(fullPath)) {
          validDownloads.add(path.resolve(fullPath));
        } else {
          console.log(`❌ Missing cached file: ${path.basename(file)}`);
        }
      } catch (error) {
        console.log(`⚠️ Error checking file ${path.basename(file)}: ${error.message}`);
      }
    }
    player.downloadedFiles = validDownloads;

    if (state.currentDownloadedFile) {
      const fullPath = path.isAbsolute(state.currentDownloadedFile) ? state.currentDownloadedFile : path.join(cacheDir, state.currentDownloadedFile);
      if (fsSync.existsSync(fullPath)) {
        player.currentDownloadedFile = path.resolve(fullPath);
      } else {
        player.currentDownloadedFile = null;
      }
    } else {
      player.currentDownloadedFile = null;
    }

    const resumeMsRaw = Number(state.playbackPositionMs) || 0;
    const trackDurationMs = player.currentTrack?.duration ? Number(player.currentTrack.duration) * 1000 : null;
    let resumeMs = Math.max(0, resumeMsRaw);
    if (trackDurationMs && resumeMs > Math.max(trackDurationMs - 2000, 0)) {
      resumeMs = 0;
    }

    player.currentTrackStartOffsetMs = Math.max(Number(state.currentTrackStartOffsetMs) || 0, 0);
    player.lastPlaybackPosition = resumeMs;
    player.paused = false;

    if (!player.connection) {
      try {
        const connected = await player.connect();
        if (!connected) {
          throw new Error("Failed to reconnect to voice channel");
        }
      } catch (error) {
        console.error("❌ Failed to connect during restore:", error.message);
        throw new Error("Failed to reconnect to voice channel", { cause: error });
      }
    }

    if (!player.currentTrack) {
      CacheManager.removePlayerSession(player.guild.id);
      return;
    }

    // 재시작 전 수동 일시정지는 멈춘 상태로 복원
    // alone/mute 같은 상황성 사유는 복원 시점의 실제 상황이 다를 수 있어 재적용하지 않음
    // 해당 조건이면 voiceStateUpdate/자리비움 로직이 다시 걸어준다.
    // 사유 없는 paused(레거시 세션)도 수동으로 간주.
    const savedReasons = Array.isArray(state.pauseReasons) ? state.pauseReasons : [];
    const restoreManualPause = Boolean(state.paused) && (savedReasons.includes("manual") || savedReasons.length === 0);
    if (restoreManualPause) player.pauseReasons.add("manual"); // play()가 시작 직후 즉시 일시정지

    await player.play(null, resumeMs);
    if (restoreManualPause) player.pauseFor("manual"); // paused 플래그 동기화 (UI/직렬화 일관성)

    if (player.resource?.volume) {
      player.resource.volume.setVolume(player.volume / 100);
    }

    const embedManager = player.guild?.client?.musicEmbedManager;
    if (embedManager && player.textChannel) {
      try {
        // 이전 세션의 오래된 현재 재생 메시지 제거;
        // 웹훅 소유이거나 CV2일 수 있어 제자리 수정은 신뢰할 수 없음
        if (state.nowPlayingMessageId) {
          const oldMessage = await player.textChannel.messages.fetch(state.nowPlayingMessageId).catch(() => null);
          if (oldMessage) await oldMessage.delete().catch(() => {});
        }

        // 새 CV2 현재 재생 메시지 전송 (진행 갱신도 시작)
        const memberLike = { id: state.requesterId || player.guild.client.user.id, guild: player.guild };
        await embedManager.createNewMusicEmbed(player, player.currentTrack, memberLike, null);
      } catch (error) {
        console.error("❌ Failed to rebuild now playing embed during restore:", error?.message || error);
      }
    }

    if (player.textChannel && player.currentTrack) {
      try {
        const resumeMessage = "음악 재개됨";
        const positionSeconds = Math.floor(resumeMs / 1000);
        const positionFormatted = formatDuration(positionSeconds);

        await player.textChannel.send({
          content: `▶️ ${resumeMessage} • **${player.currentTrack.title || "Unknown"}** (${positionFormatted})`,
        });
      } catch (error) {
        // 메시지를 보낼 수 없으면 무시
      }
    }

    this.scheduleStatePersist("restored", 1000);
  }

  async persistState(reason = "manual", immediate = false) {
    const player = this.player;
    try {
      if (!player.guild?.id) return;

      // 즉시 저장이면 대기 중인 저장 취소
      if (immediate) {
        this.cancelStateSave();
      }

      if (!player.currentTrack && player.queue.length === 0) {
        CacheManager.removePlayerSession(player.guild.id);
        return;
      }

      const state = this.serializeState();
      if (!state) {
        CacheManager.removePlayerSession(player.guild.id);
        return;
      }

      state.reason = reason;
      CacheManager.savePlayerSession(player.guild.id, state);
    } catch (error) {
      console.error(`❌ Failed to persist player state for guild ${player.guild?.id}:`, error.message || error);
    }
  }

  startStateSync() {
    const player = this.player;
    if (player.stateSyncInterval) return;

    player.stateSyncInterval = setInterval(() => {
      if (!player.guild?.id) return;
      if (!player.currentTrack && player.queue.length === 0) return;

      this.persistState("interval").catch(() => {});
    }, player.stateSyncIntervalMs);
  }

  stopStateSync() {
    const player = this.player;
    if (player.stateSyncInterval) {
      clearInterval(player.stateSyncInterval);
      player.stateSyncInterval = null;
    }

    this.cancelStateSave();
  }

  cancelStateSave() {
    const player = this.player;
    if (player.stateSaveTimeout) {
      clearTimeout(player.stateSaveTimeout);
      player.stateSaveTimeout = null;
    }
  }

  scheduleStatePersist(reason = "update", delay = 200) {
    const player = this.player;
    this.cancelStateSave();
    player.stateSaveTimeout = setTimeout(
      () => {
        player.stateSaveTimeout = null;
        this.persistState(reason).catch(() => {});
      },
      Math.max(delay, 0),
    );
  }
}

module.exports = SessionPersistence;
