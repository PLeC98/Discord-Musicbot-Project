const { AudioPlayerStatus, createAudioPlayer, createAudioResource, StreamType } = require("@discordjs/voice");
const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");

function isBotOwnedStatus(s) {
  if (!s) return true;
  const cfg = require("../config").voiceStatus;
  if (s === cfg.idleText) return true;
  return [cfg.playingPrefix, cfg.pausedPrefix].some((p) => s.startsWith(p));
}
const config = require("../config");
const ErrorHandler = require("./ErrorHandler");
const TrackResolver = require("./TrackResolver");
const DirectLink = require("./DirectLink");
const CacheManager = require("./CacheManager");
const VoiceConnectionManager = require("./VoiceConnectionManager");
const TrackDownloader = require("./TrackDownloader");
const createPlayerSessionId = require("./playerSessionId");
const SessionPersistence = require("./SessionPersistence");
const prism = require("prism-media");
const ffmpegPath = require("ffmpeg-static");
const { Readable } = require("stream");
const fsSync = require("fs");
const path = require("path");

class MusicPlayer {
  constructor(guild, textChannel, voiceChannel) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;

    // 오디오 플레이어 설정
    this.audioPlayer = createAudioPlayer();
    this.connection = null;
    this.resource = null;

    // 대기열 관리
    this.queue = [];
    this.currentTrack = null;
    this.previousTracks = [];
    // 캐시 퇴거 보호 중인 audioSourceKey — currentTrack과 별도로 기억해, 종료 경로가
    // currentTrack을 먼저 null해도 해제가 누락되지 않게 한다 (감사 L-02)
    this._protectedAudioKey = null;

    // 플레이어 설정
    this.volume = config.bot.defaultVolume;
    this.loop = false; // false, 'track', 'queue' 중 하나
    this.shuffle = false;
    this.autoplay = false; // false 또는 장르 문자열: 'pop', 'rock', 'hiphop' 등
    this.paused = false;

    // 타임스탬프
    this.startTime = null;
    this.pausedTime = 0;

    // 필터
    this.currentFilter = null;

    // UI 관리
    this.nowPlayingMessage = null;
    this.requesterId = null;

    // 세션 관리 - 오래된 버튼 상호작용을 막기 위한 고유 ID
    this.sessionId = createPlayerSessionId();

    // 사전 로드 시스템 - 대기열의 모든 트랙을 즉시 사전 로드
    this.preloadedStreams = new Map(); // trackUrl -> streamInfo 매핑
    this.preloadingQueue = []; // 사전 로드 중인 URL

    // 음성 연결 복구 시스템
    this.isRecovering = false;
    this.maxRecoveryAttempts = 5;
    this.recoveryAttempts = 0;
    this.recoveryInterval = null;
    this.connectionHealthCheck = null;

    // 재생 생명주기 상태
    this.trackTimer = null;
    this.isTransitioning = false;
    this.pendingEndReason = null;
    this.currentTrackRetries = 0;
    this.skipRequested = false;
    this.stopRequested = false;
    this.nextFromFront = false; // 셔플을 우회해 대기열 앞쪽에서 다음 트랙을 강제 선택 (이동/이전곡)
    this.expectedTrackEndTs = null;
    this.currentTrackCache = null;
    this.activeStreamInfo = null;
    this.lastPlaybackPosition = 0;
    this.currentTrackStartOffsetMs = 0;

    // 음성 채널 상태 소유권
    this._voiceStatusOwned = false;

    // 영속화 관리
    this.stateSyncInterval = null;
    this.stateSyncIntervalMs = 5000;
    this.stateSaveTimeout = null;

    // 일시정지 관리
    this.pauseReasons = new Set();

    // 비활성 타임아웃
    this.inactivityTimer = null;
    this.inactivityTimeoutMs = config.bot.leaveDelayAloneMs;

    // 로컬 파일 캐싱
    this.currentDownloadedFile = null; // 현재 재생 중인 다운로드 파일 경로
    this.downloadedFiles = new Set(); // 정리를 위해 모든 다운로드 파일 추적
    this.downloadingFiles = new Map(); // filepath -> 진행 중 다운로드 Promise (중복 방지 + 완료 대기, §2.5)

    // 협력 모듈 — 로직 분리 (상태 필드는 전부 이 인스턴스에 유지)
    this.voice = new VoiceConnectionManager(this);
    this.downloader = new TrackDownloader(this);
    this.persistence = new SessionPersistence(this);

    // 이벤트 설정
    this.setupEvents();
  }

  setupEvents() {
    // 오디오 플레이어 이벤트
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      // 재개 시 경과 오프셋을 반영해 startTime 조정
      if (this.paused && this.pausedTime > 0) {
        // 일시정지에서 재개 - 누적 pausedTime 유지
        this.startTime = Date.now();
      } else if (!this.startTime) {
        // 첫 재생 - 오프셋을 반영해 시작 시간 설정
        this.startTime = Date.now();
      }
      this.paused = false;
      if (this.currentTrack) {
        const { playingPrefix } = config.voiceStatus;
        this.updateVoiceStatus(`${playingPrefix}${this.currentTrack.title}`).catch(() => {});
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      if (this.startTime) {
        this.pausedTime += Date.now() - this.startTime;
      }
      this.paused = true;
      if (this.currentTrack) {
        const { pausedPrefix } = config.voiceStatus;
        this.updateVoiceStatus(`${pausedPrefix}${this.currentTrack.title}`).catch(() => {});
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this.onPlayerIdle("idle");
    });

    this.audioPlayer.on("error", (error) => {
      console.error("🎵 Audio player error:", error);

      // 스트림 오류이고 현재 트랙이 있으면 복구 시도
      if (this.currentTrack && error.message && (error.message.includes("stream") || error.message.includes("network"))) {
        this.voice.startConnectionRecovery();
      } else {
        this.handleError(error);
      }
    });

    // 연결 상태 모니터링 시작
    this.voice.startConnectionHealthCheck();

    // 음성 연결 이벤트는 VoiceConnectionManager.setupConnectionEvents()에서 설정됨
    this.voice.setupConnectionEvents();
  }

  // ── 음성 연결 — 로직은 VoiceConnectionManager, 상태 필드는 이 인스턴스에 유지 ──

  connect() {
    return this.voice.connect();
  }

  moveToChannel(newChannel) {
    return this.voice.moveToChannel(newChannel);
  }

  disconnect() {
    return this.voice.disconnect();
  }

  async addTrack(query, requestedBy) {
    try {
      // 해석(플랫폼 감지·캐시 숏컷 포함)은 TrackResolver 한 곳에서 — /play와 동일 경로
      const resolved = await TrackResolver.resolveQuery(query, this.guild.id, "MusicPlayer.addTrack");
      if (!resolved.success) {
        return { success: false, message: resolved.message || "결과를 찾을 수 없습니다!" };
      }
      const tracks = resolved.tracks;

      // 트랙을 대기열에 추가
      const addedTracks = [];
      const wasIdle = !this.currentTrack; // 수정 전 상태 기억

      for (const track of tracks.slice(0, config.bot.maxPlaylistSize)) {
        track.requestedBy = requestedBy;
        track.addedAt = Date.now();

        if (this.currentTrack) {
          this.queue.push(track);
        } else {
          this.currentTrack = track;
        }
        addedTracks.push(track);
      }

      // 다음 몇 곡을 순차적으로 사전 로드 (병렬 처리 시 YouTube 속도 제한 가능)
      const toPreload = addedTracks
        .filter((t, i) => !(wasIdle && i === 0)) // 곧바로 재생할 트랙은 건너뜀
        .slice(0, config.preload.ahead);

      (async () => {
        for (const track of toPreload) {
          if (this.preloadedStreams.has(track.url) || this.preloadingQueue.includes(track.url)) continue;
          try {
            await this.preloadTrack(track);
            await new Promise((r) => setTimeout(r, config.preload.gapMs));
          } catch (err) {
            if (err && err.message) console.error(`❌ Preload error for ${track.title}:`, err.message);
          }
        }
      })();

      // 현재 재생 중이 아니면 자동 재생
      if (wasIdle) {
        // 플레이어가 유휴 상태였으므로 처음 추가된 트랙을 처음부터 재생
        if (addedTracks.length > 0) {
          this.currentTrack = addedTracks[0];
          await this.play(null, 0);
        }
      } else if (this.audioPlayer.state && this.audioPlayer.state.status === AudioPlayerStatus.Idle) {
        // 플레이어는 있지만 유휴 상태(재생 완료) - 대기열의 다음 곡 시작
        await this.play(null, 0);
      }

      const result = {
        success: true,
        tracks: addedTracks,
        isPlaylist: tracks.length > 1,
        position: this.queue.length,
      };

      await this.persistState("queue-update");
      return result;
    } catch (error) {
      return { success: false, message: "트랙 추가 중 오류!" };
    }
  }

  // ── 다운로드/사전 로드 — 로직은 TrackDownloader ──────────────────────────

  preloadTrack(track) {
    return this.downloader.preloadTrack(track);
  }

  async play(trackIndex = null, seekMs = 0) {
    try {
      // 현재 트랙이 없으면 대기열에서 가져오기
      if (!this.currentTrack) {
        if (this.queue.length === 0) {
          return { success: false, message: "대기열에 트랙이 없습니다!" };
        }
        this.currentTrack = this.queue.shift();
      }

      // 특정 트랙이 요청된 경우
      if (trackIndex !== null && this.queue[trackIndex]) {
        this.currentTrack = this.queue.splice(trackIndex, 1)[0];
      }

      // 연결되어 있지 않으면 음성 채널에 연결
      if (!this.connection) {
        const connected = await this.connect();
        if (!connected) {
          return { success: false, message: "음성 채널에 연결하지 못했습니다!" };
        }
      }

      // 새 재생을 위해 생명주기 플래그 재설정
      this.pendingEndReason = null;
      this.skipRequested = false;
      this.stopRequested = false;
      const resumeFromMs = Math.max(0, Math.floor(Number(seekMs) || 0));
      const resumeFromSeconds = resumeFromMs / 1000;
      this.currentTrackStartOffsetMs = resumeFromMs;
      this.lastPlaybackPosition = resumeFromMs;
      this.pausedTime = 0;
      this.startTime = null; // Playing 이벤트 발생 시 설정됨

      // 오디오 스트림 가져오기 - 사전 로드된 항목 먼저 확인
      let streamInfo;

      // audioSourceKey를 미리 해석 (yt-dlp 호출 전 파일 조회 가능; spotify는 YouTube 검색 후 해석)
      TrackResolver.ensureAudioSourceKey(this.currentTrack);

      // 조기 파일 확인 — 파일이 이미 캐시되어 있으면 yt-dlp 호출을 전부 건너뜀
      let downloadedFile;
      let shouldDownload = false;

      if (this.currentDownloadedFile && fsSync.existsSync(this.currentDownloadedFile) && !this.downloadingFiles.has(this.currentDownloadedFile)) {
        downloadedFile = this.currentDownloadedFile;
      } else if (this.currentTrack.audioSourceKey) {
        const _earlyPath = this.currentTrack._cachedFilePath || CacheManager.getFilePath(this.currentTrack.audioSourceKey);
        if (fsSync.existsSync(_earlyPath) && !this.downloadingFiles.has(_earlyPath)) {
          const _earlyStats = fsSync.statSync(_earlyPath);
          if (_earlyStats.size > 0) {
            downloadedFile = _earlyPath;
            this.downloadedFiles.add(_earlyPath);
            this.currentDownloadedFile = _earlyPath;
          }
        }
      }

      // 재개 시 캐시 재사용 시도
      if (resumeFromMs > 0) {
        const cached = this.getCachedStreamForCurrentTrack(resumeFromSeconds);
        if (cached) {
          streamInfo = cached;
        }
      }

      // 스트림이 이미 사전 로드되었는지 확인 (새 재생일 때만)
      const preloaded = !streamInfo && resumeFromMs === 0 ? this.preloadedStreams.get(this.currentTrack.url) : null;
      if (!streamInfo && preloaded) {
        streamInfo = preloaded.info;
        // 사용 중이므로 캐시에서 제거
        this.preloadedStreams.delete(this.currentTrack.url);
      }

      if (!streamInfo && !downloadedFile) {
        // spotify는 YouTube 동등물을 먼저 확보 — 검색으로 audioSourceKey가 정해지므로
        // 캐시 파일을 한 번 더 확인해 있으면 스트림 획득을 통째로 건너뜀
        if (this.currentTrack.platform === "spotify") {
          const ytUrl = await TrackResolver.findYouTubeEquivalent(this.currentTrack, this.guild.id);
          if (!ytUrl) {
            throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${this.currentTrack.title}`);
          }
          if (this.currentTrack.audioSourceKey) {
            const _spotPath = CacheManager.getFilePath(this.currentTrack.audioSourceKey);
            if (fsSync.existsSync(_spotPath) && fsSync.statSync(_spotPath).size > 0) {
              downloadedFile = _spotPath;
              this.downloadedFiles.add(_spotPath);
              this.currentDownloadedFile = _spotPath;
            }
          }
        }

        // 일반 방식으로 스트림 가져오기 (플랫폼 스위치는 TrackResolver 한 곳에서)
        if (!downloadedFile) {
          streamInfo = await TrackResolver.getStream(this.currentTrack, this.guild.id, resumeFromSeconds);
        }
      }

      if (!streamInfo && !downloadedFile) {
        throw new Error("오디오 스트림 가져오기 실패");
      }

      // 기존(string) 및 신규(object) 스트림 형식을 모두 처리
      let streamUrl_final;

      if (typeof streamInfo === "string") {
        streamUrl_final = streamInfo;
      } else if (streamInfo && typeof streamInfo === "object") {
        if (streamInfo.stream) {
          streamUrl_final = streamInfo.stream;
        } else {
          streamUrl_final = streamInfo.url;
        }
      } else {
        streamUrl_final = streamInfo;
      }

      // 플래그: 스트림은 있지만 캐시 파일이 없으면 다운로드 필요
      if (!downloadedFile) shouldDownload = true;

      // 다운로드가 필요하면 백그라운드 다운로드와 동시에 즉시 스트리밍 시작
      if (shouldDownload) {
        // 백그라운드에서 다운로드 시작 (await하지 않음)
        const filepath = this.downloader.trackFilePath(this.currentTrack);

        // 백그라운드 다운로드용 트랙 참조 저장 (currentTrack이 바뀔 수 있음)
        const trackToDownload = this.currentTrack;

        // 백그라운드에서 다운로드
        this.downloader
          .downloadTrack(trackToDownload)
          .then((file) => {
            // 여전히 같은 트랙일 때만 갱신
            if (this.currentTrack && this.currentTrack.url === trackToDownload.url) {
              this.currentDownloadedFile = file;
            }
          })
          .catch((err) => {
            if (err && err.message) {
              console.error(`⚠️ Background download failed: ${err.message}`);
            }
          });

        // 즉시 재생을 위해 직접 스트리밍
        let audioStream;
        if (typeof streamInfo === "object" && streamInfo.stream) {
          audioStream = streamInfo.stream;
        } else if (typeof streamUrl_final === "string") {
          try {
            if (this.currentTrack.platform === "direct") {
              // 직접 링크는 SSRF 가드(SafeUrl)를 통과해 스트림을 연다
              audioStream = await DirectLink.getStream(streamUrl_final, this.guild.id);
            } else {
              const response = await fetch(streamUrl_final, {
                headers: streamInfo?.httpHeaders || {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
              });

              if (!response.ok) throw new Error(`Failed to fetch stream: ${response.status}`);

              audioStream = typeof response.body?.getReader === "function" && typeof Readable.fromWeb === "function" ? Readable.fromWeb(response.body) : response.body;
            }
          } catch (fetchError) {
            // 스트리밍 실패 — 위에서 시작한 백그라운드 다운로드로 폴백 (§2.5: 폴링 대신 promise 대기)
            if (fsSync.existsSync(filepath) && fsSync.statSync(filepath).size > 0) {
              // 이미 완료됨
              shouldDownload = false; // 파일 모드로 전환
              downloadedFile = filepath;
            } else {
              const inFlight = this.downloadingFiles.get(filepath);
              if (inFlight) {
                try {
                  downloadedFile = await inFlight;
                  shouldDownload = false; // 파일 모드로 전환
                } catch {
                  /* 다운로드도 실패 — 아래에서 원래 스트리밍 오류를 던짐 */
                }
              }
            }

            if (!downloadedFile) throw fetchError;
          }
        } else {
          audioStream = streamUrl_final;
        }

        // 스트리밍에 실패했고 다운로드 파일이 있으면 파일 재생으로 건너뜀
        if (!audioStream && downloadedFile) {
          shouldDownload = false; // 파일 재생으로 이어서 진행
        } else if (audioStream) {
          // 스트리밍용 FFmpeg 프로세스 생성
          const seekArgs = resumeFromMs > 0 ? ["-ss", (resumeFromMs / 1000).toFixed(3)] : [];

          const ffmpegProcess = new prism.FFmpeg({
            command: ffmpegPath,
            args: [
              ...seekArgs, // 재개 중이면 seek 추가
              "-analyzeduration",
              "0",
              "-loglevel",
              "0",
              "-i",
              "pipe:0",
              "-f",
              "s16le",
              "-ar",
              "48000",
              "-ac",
              "2",
            ],
          });

          ffmpegProcess.on("error", (err) => {
            if (err.message && err.message.includes("Premature close")) return;
            console.error("❌ FFmpeg streaming error:", err.message);
          });

          // 이것이 없으면 스트림 중간의 CDN ECONNRESET이 위로 전파되어 uncaughtException이 될 수 있음. AudioPlayer가 Idle로 전환되면 이미 캐시 기반 복구가 트리거되므로 여기서는 오류를 흡수하기만 하면 됨.
          audioStream.on("error", (err) => {
            console.warn(`⚠️ Audio stream dropped (${err.code || err.message}), recovering from cache...`);
          });

          // 리소스가 교체되거나 중지될 때 ffmpegProcess는 @discordjs/voice 파이프라인 연쇄 처리로 제거됨. audioStream은 그 파이프라인 밖에 있으므로(.pipe()로 연결), 자동으로 제거되지 않음 — HTTP 연결을 명시적으로 닫음.
          ffmpegProcess.once("close", () => audioStream.destroy());

          audioStream.pipe(ffmpegProcess);

          this.resource = createAudioResource(ffmpegProcess, {
            inputType: StreamType.Raw,
            inlineVolume: true,
            metadata: {
              title: this.currentTrack.title,
              url: this.currentTrack.url,
              duration: streamInfo.duration || this.currentTrack.duration,
              bitrate: streamInfo.bitrate || 128,
            },
          });
        }
      }

      // 파일 재생 모드 (사전 다운로드 또는 스트리밍 폴백)
      if (!shouldDownload && downloadedFile) {
        console.log(`🎵 Playing from cached file: ${path.basename(downloadedFile)} (seek: ${resumeFromMs}ms)`);

        const seekArgs = resumeFromMs > 0 ? ["-ss", (resumeFromMs / 1000).toFixed(3)] : [];

        const ffmpegProcess = new prism.FFmpeg({
          command: ffmpegPath,
          args: [
            ...seekArgs, // 더 빠른 탐색을 위해 입력 전에 seek 추가
            "-i",
            downloadedFile,
            "-analyzeduration",
            "0",
            "-loglevel",
            "0",
            "-f",
            "s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
          ],
        });

        ffmpegProcess.on("error", (err) => {
          if (err.message && err.message.includes("Premature close")) return;
          console.error("❌ FFmpeg playback error:", err.message);
        });

        this.resource = createAudioResource(ffmpegProcess, {
          inputType: StreamType.Raw,
          inlineVolume: true,
          metadata: {
            title: this.currentTrack.title,
            url: this.currentTrack.url,
            duration: (streamInfo && streamInfo.duration) || this.currentTrack.duration,
            bitrate: (streamInfo && streamInfo.bitrate) || 128,
          },
        });
      }

      // 리소스가 있는지 확인
      if (!this.resource) {
        throw new Error("Failed to create audio resource");
      }

      // 볼륨 설정
      if (this.resource.volume) {
        this.resource.volume.setVolume(this.volume / 100);
      }

      // 가능하면 스트림 정보에서 트랙 길이 갱신
      if (streamInfo && streamInfo.duration && streamInfo.duration > 0) {
        this.currentTrack.duration = streamInfo.duration;
      }

      console.log(`▶️  Playing: ${this.currentTrack.title} (${this.currentTrack.duration}s, offset: ${resumeFromMs}ms)`);

      // 재생 중인 현재 트랙을 제거 대상에서 보호 (해제는 releaseAudioProtection)
      if (this._protectedAudioKey && this._protectedAudioKey !== this.currentTrack.audioSourceKey) {
        CacheManager.unprotect(this._protectedAudioKey);
        this._protectedAudioKey = null;
      }
      if (this.currentTrack.audioSourceKey) {
        this._protectedAudioKey = this.currentTrack.audioSourceKey;
        CacheManager.protect(this._protectedAudioKey);
      }

      // 리소스 재생
      this.audioPlayer.play(this.resource);

      // 재생 통계와 소스 URL → audioSourceKey 매핑을 DB에 기록
      if (this.currentTrack.audioSourceKey) {
        CacheManager.recordPlayback(this.currentTrack.audioSourceKey);
        CacheManager.recordTrackLookup(this.currentTrack.url, this.currentTrack.platform, this.currentTrack.audioSourceKey, this.currentTrack.title, this.currentTrack.artist, this.currentTrack.thumbnail);
      }

      if (this.pauseReasons.size > 0) {
        console.log(`⏸️  Paused due to: ${Array.from(this.pauseReasons).join(", ")}`);
        this.audioPlayer.pause();
      }

      // 빠른 재개를 위해 활성 스트림 정보 저장
      // 참고: JS에서 typeof null === 'object'는 true — null 안전 가드 사용
      const baseSourceUrl = streamInfo && typeof streamInfo === "object" ? streamInfo.rawUrl || streamInfo.url || (typeof streamUrl_final === "string" ? streamUrl_final : null) : streamUrl_final;

      this.activeStreamInfo = {
        trackKey: this.getTrackCacheKey(this.currentTrack),
        platform: this.currentTrack.platform,
        fetchedAt: Date.now(),
        resumeSupported: streamInfo && typeof streamInfo === "object" ? Boolean(streamInfo.canSeek) : false,
        baseUrl: baseSourceUrl,
        info: streamInfo && typeof streamInfo === "object" ? streamInfo : { url: streamUrl_final },
      };

      // 이후 재개 시도를 위해 현재 스트림 캐시
      this.currentTrackCache = this.activeStreamInfo;

      // 정상 완료를 보장하고 성급한 전환을 막기 위해 워치독 예약
      this.scheduleTrackWatchdog(streamInfo);

      this.startStateSync();
      await this.persistState(resumeFromMs > 0 ? "resume-playback" : "play");

      return { success: true, track: this.currentTrack };
    } catch (error) {
      const errorMsg = ErrorHandler.handle(error, this.guild.id, "MusicPlayer.play");
      await this.handleError(error, errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  scheduleTrackWatchdog(streamInfo = null) {
    if (this.trackTimer) {
      clearTimeout(this.trackTimer);
    }

    const streamDuration = streamInfo && Number(streamInfo.duration) > 0 ? Number(streamInfo.duration) : null;
    const trackDuration = this.currentTrack && Number(this.currentTrack.duration) > 0 ? Number(this.currentTrack.duration) : null;
    const durationSeconds = streamDuration || trackDuration;

    if (durationSeconds && durationSeconds > 0) {
      // 시작 오프셋을 고려해 남은 시간 계산 (초)
      const startOffsetSeconds = Math.floor((this.currentTrackStartOffsetMs || 0) / 1000);
      const remainingSeconds = Math.max(1, durationSeconds - startOffsetSeconds);

      this.expectedTrackEndTs = Date.now() + remainingSeconds * 1000;
      // 4초 버퍼를 추가하되 최소 5초 타임아웃 보장
      const timeoutMs = Math.max(remainingSeconds * 1000 + 4000, 5000);

      console.log(`🕒 Track watchdog: ${remainingSeconds}s remaining (${durationSeconds}s total, ${startOffsetSeconds}s offset)`);
      this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), timeoutMs);
    } else {
      // 폴백 워치독: 길이를 알 수 없는 스트림은 5분마다 확인
      this.expectedTrackEndTs = null;
      this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), 5 * 60 * 1000);
    }
  }

  getTrackCacheKey(track) {
    if (!track) return null;
    return track.id || track.url || `${track.title}-${track.duration}`;
  }

  getCachedStreamForCurrentTrack(seekSeconds) {
    if (!this.currentTrackCache) return null;
    const key = this.getTrackCacheKey(this.currentTrack);
    if (!key || this.currentTrackCache.trackKey !== key) return null;
    if (!this.currentTrackCache.resumeSupported || !this.currentTrackCache.baseUrl) return null;
    const seekUrl = this.applySeekToUrl(this.currentTrackCache.baseUrl, seekSeconds);
    if (!seekUrl) return null;

    return {
      ...this.currentTrackCache.info,
      url: seekUrl,
      canSeek: true,
      fromCache: true,
      duration: this.currentTrackCache.info?.duration || this.currentTrack.duration,
    };
  }

  applySeekToUrl(baseUrl, seekSeconds) {
    if (!baseUrl) return null;
    if (seekSeconds <= 0) return baseUrl;

    let url = baseUrl.replace(/(&|\?)begin=\d+/g, "");
    url = url.replace(/(&|\?)start=\d+/g, "");

    const isYouTubeStream = /googlevideo\.com/i.test(url);
    if (!isYouTubeStream) {
      // TODO: 가능해지면 다른 제공자 지원 추가
      return null;
    }

    const separator = url.includes("?") ? "&" : "?";
    const startMs = Math.max(0, Math.floor(seekSeconds * 1000));
    return `${url}${separator}begin=${startMs}`;
  }

  ensureTrackCompletion() {
    if (!this.currentTrack) {
      this.trackTimer = null;
      return;
    }

    const status = this.audioPlayer.state?.status;

    if (status === AudioPlayerStatus.Playing) {
      const playbackMs = this.resource?.playbackDuration || 0;
      const durationMs = (Number(this.currentTrack.duration) || 0) * 1000;

      if (durationMs > 0 && playbackMs + 1500 < durationMs) {
        const remainingMs = Math.max(durationMs - playbackMs, 2000);
        this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), remainingMs);
        return;
      }

      // Idle을 발생시키고 생명주기 핸들러가 실행되도록 정상 중지
      if (!this.pendingEndReason) {
        this.pendingEndReason = "watchdog";
      }
      this.audioPlayer.stop();
      this.trackTimer = null;
      return;
    }

    if (status === AudioPlayerStatus.Idle || status === AudioPlayerStatus.AutoPaused) {
      // Idle 핸들러가 처리하므로 할 일 없음
      this.trackTimer = null;
      return;
    }

    // 알 수 없는 상태, 계속 감시
    this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), 2000);
  }

  onPlayerIdle(trigger = "idle") {
    const reason = this.consumePendingEndReason(trigger);

    // 재생 통계가 마무리되도록 약간 지연
    setTimeout(() => {
      this.handleTrackEnd(reason).catch(console.error);
    }, 60);
  }

  consumePendingEndReason(defaultReason = "idle") {
    const reason = this.pendingEndReason || defaultReason;
    this.pendingEndReason = null;
    return reason;
  }

  pause(reason = "manual") {
    return this.pauseFor(reason);
  }

  resume(reason = "manual") {
    return this.resumeFor(reason);
  }

  pauseFor(reason = null) {
    if (reason) {
      this.pauseReasons.add(reason);
      this.scheduleStatePersist("pause-update", 200);
    }

    const status = this.audioPlayer.state.status;
    if (status === AudioPlayerStatus.Paused) {
      this.paused = true;
      this.scheduleStatePersist("pause", 0);
      return true;
    }

    if (status === AudioPlayerStatus.Playing) {
      const paused = this.audioPlayer.pause();
      if (paused) {
        this.paused = true;
        this.scheduleStatePersist("pause", 0);
        return true;
      }
    }

    return false;
  }

  resumeFor(reason = null) {
    if (reason) {
      this.pauseReasons.delete(reason);
      this.scheduleStatePersist("resume-update", 200);
    }

    if (this.pauseReasons.size > 0) {
      return false;
    }

    const status = this.audioPlayer.state.status;
    if (status === AudioPlayerStatus.Paused) {
      const resumed = this.audioPlayer.unpause();
      if (resumed) {
        this.paused = false;
        this.scheduleStatePersist("resume", 0);
        return true;
      }
      return false;
    }

    if (status === AudioPlayerStatus.Playing) {
      this.paused = false;
      this.scheduleStatePersist("resume", 0);
      return true;
    }

    return false;
  }

  startInactivityTimer() {
    if (this.inactivityTimer) return;

    this.pauseFor("alone");

    this.inactivityTimer = setTimeout(
      async () => {
        this.inactivityTimer = null;

        const channelId = this.voiceChannel?.id;
        const channel = channelId ? this.guild.channels.cache.get(channelId) : null;
        const hasListeners = channel ? channel.members.filter((member) => !member.user.bot).size > 0 : false;

        if (hasListeners) {
          this.resumeFor("alone");
          const embedManager = this.guild?.client?.musicEmbedManager;
          if (embedManager) {
            await embedManager.updateNowPlayingEmbed(this);
          }
          return;
        }

        this.pauseReasons.clear();
        this.pendingEndReason = "inactivity-timeout";
        this.queue = [];
        this.currentTrack = null;

        try {
          const embedManager = this.guild?.client?.musicEmbedManager;
          if (embedManager) {
            await embedManager.handlePlaybackEnd(this);
          } else if (typeof this.showQueueCompleted === "function") {
            await this.showQueueCompleted();
          }

          await this.persistState("inactivity-timeout");
        } catch (error) {
          console.error("❌ Failed to update playback UI after inactivity timeout:", error);
        } finally {
          try {
            this.cleanup();
          } finally {
            const client = this.guild?.client;
            if (client?.players) {
              client.players.delete(this.guild.id);
            }
          }
        }
      },
      Math.max(this.inactivityTimeoutMs, 0),
    );
  }

  clearInactivityTimer(shouldResume = true) {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }

    if (shouldResume) {
      this.resumeFor("alone");
    } else {
      this.pauseReasons.delete("alone");
    }
  }

  /**
   * 재생 상태나 저장된 세션 데이터를 건드리지 않고 모든 반복 타이머를 해제합니다.
   * 플레이어가 폐기될 때마다 (stop/leave/접속 실패) 호출해야 합니다.
   * 그렇지 않으면 30초 상태 검사 interval이 플레이어 객체를 영원히 붙잡습니다.
   */
  releaseResources() {
    this.clearInactivityTimer(false);
    this.stopStateSync();
    this.voice.stopConnectionRecovery();

    if (this.connectionHealthCheck) {
      clearInterval(this.connectionHealthCheck);
      this.connectionHealthCheck = null;
    }

    if (this.trackTimer) {
      clearTimeout(this.trackTimer);
      this.trackTimer = null;
    }
  }

  // 재생 중 트랙의 캐시 퇴거 보호 해제 — currentTrack이 이미 null이어도 기억된 키로 해제
  releaseAudioProtection() {
    const key = this._protectedAudioKey || this.currentTrack?.audioSourceKey;
    if (key) CacheManager.unprotect(key);
    this._protectedAudioKey = null;
  }

  stop() {
    this.updateVoiceStatus("").catch(() => {});

    this.pauseReasons.clear();
    this.paused = false;

    this.releaseResources();
    if (this.guild?.id) {
      CacheManager.removePlayerSession(this.guild.id);
    }

    this.releaseAudioProtection();

    this.currentDownloadedFile = null;
    this.downloadedFiles.clear();

    this.queue = [];
    this.currentTrack = null;
    this.pendingEndReason = "stop";
    this.stopRequested = true;
    this.nextFromFront = false;
    this.currentTrackStartOffsetMs = 0;
    this.lastPlaybackPosition = 0;
    this.audioPlayer.stop(true);
    this.disconnect();
  }

  async leaveAndSave() {
    this.updateVoiceStatus("").catch(() => {});

    // 연결 해제 전에 전체 상태(대기열, 위치, 설정) 저장
    await this.persistState("leave", true);

    // stop()과 같은 연결 해제 절차이지만 removePlayerSession은 호출하지 않음
    this.pauseReasons.clear();
    this.paused = false;
    this.releaseResources();

    this.releaseAudioProtection();

    this.currentDownloadedFile = null;
    this.downloadedFiles.clear();

    this.queue = [];
    this.currentTrack = null;
    this.pendingEndReason = "stop";
    this.stopRequested = true;
    this.nextFromFront = false;
    this.currentTrackStartOffsetMs = 0;
    this.lastPlaybackPosition = 0;
    this.audioPlayer.stop(true);
    this.disconnect();
  }

  skip() {
    if (this.currentTrack) {
      // 트랙 타이머 정리
      if (this.trackTimer) {
        clearTimeout(this.trackTimer);
        this.trackTimer = null;
      }

      this.pendingEndReason = "skip";
      this.skipRequested = true;
      this.audioPlayer.stop(true);
      this.scheduleStatePersist("skip", 0);
      return true;
    }
    return false;
  }

  previous() {
    if (this.previousTracks.length > 0) {
      // 이전 트랙을 맨 앞에 넣고 그 곡으로 건너뜀. 현재 트랙은 currentTrack으로 남겨 handleTrackEnd가 올바르게 기록하도록 함;
      // 여기서 이전 트랙을 미리 할당하면 "예기치 않게 종료됨"
      // 재시도 로직이 그 곡을 중간부터 재개하게 됨.
      const prev = this.previousTracks.pop();
      this.queue.unshift(prev);
      // 중단된 현재 트랙을 그 바로 뒤에 넣어 대기열이 이전 트랙 종료 후 원래 위치부터 이어지게 함
      if (this.currentTrack) {
        this.queue.splice(1, 0, this.currentTrack);
      }
      this.nextFromFront = true;

      if (this.trackTimer) {
        clearTimeout(this.trackTimer);
        this.trackTimer = null;
      }

      this.pendingEndReason = "previous";
      this.skipRequested = true;
      this.audioPlayer.stop(true);
      this.scheduleStatePersist("previous", 0);
      return true;
    }
    return false;
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(100, volume));
    if (this.resource && this.resource.volume) {
      this.resource.volume.setVolume(this.volume / 100);
    }
    this.scheduleStatePersist("volume", 200);
    return this.volume;
  }

  shuffleQueue() {
    if (this.queue.length > 1) {
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
      }
      this.scheduleStatePersist("shuffle-queue", 200);
      return true;
    }
    return false;
  }

  setLoop(mode) {
    // 모드: false, 'track', 'queue'
    this.loop = mode;
    this.scheduleStatePersist("loop", 200);
    return this.loop;
  }

  setShuffle(enabled) {
    this.shuffle = enabled;
    this.scheduleStatePersist("shuffle-toggle", 200);
    return this.shuffle;
  }

  clearQueue() {
    const cleared = this.queue.length;
    this.queue = [];
    this.scheduleStatePersist("clear-queue", 0);
    return cleared;
  }

  removeFromQueue(index) {
    if (index >= 0 && index < this.queue.length) {
      const removed = this.queue.splice(index, 1)[0];
      this.scheduleStatePersist("queue-remove", 200);
      return removed;
    }
    return null;
  }

  moveInQueue(from, to) {
    if (from >= 0 && from < this.queue.length && to >= 0 && to < this.queue.length) {
      const track = this.queue.splice(from, 1)[0];
      this.queue.splice(to, 0, track);
      this.scheduleStatePersist("queue-move", 200);
      return true;
    }
    return false;
  }

  getQueue() {
    return {
      current: this.currentTrack,
      queue: this.queue,
      previous: this.previousTracks,
      totalTracks: (this.currentTrack ? 1 : 0) + this.queue.length,
      duration: this.getTotalDuration(),
    };
  }

  getTotalDuration() {
    let total = 0;
    if (this.currentTrack && this.currentTrack.duration) {
      total += this.currentTrack.duration;
    }
    this.queue.forEach((track) => {
      if (track.duration) total += track.duration;
    });
    return total;
  }

  getCurrentTime() {
    const playbackDuration = this.audioPlayer?.state?.resource?.playbackDuration;
    if (typeof playbackDuration === "number" && Number.isFinite(playbackDuration)) {
      return this.currentTrackStartOffsetMs + playbackDuration;
    }

    if (!this.startTime) return this.currentTrackStartOffsetMs;
    if (this.paused) {
      return this.currentTrackStartOffsetMs + this.pausedTime;
    }
    return this.currentTrackStartOffsetMs + (Date.now() - this.startTime) + this.pausedTime;
  }

  // 타이머 기반 트랙 완료 처리

  async handleTrackEnd(reason = "idle") {
    if (this.isTransitioning) {
      return;
    }

    this.isTransitioning = true;

    try {
      if (this.trackTimer) {
        clearTimeout(this.trackTimer);
        this.trackTimer = null;
      }

      const finishedTrack = this.currentTrack;
      this.releaseAudioProtection();
      const playbackMs = this.resource?.playbackDuration || 0;
      const totalPlaybackMs = this.currentTrackStartOffsetMs + playbackMs;
      this.lastPlaybackPosition = totalPlaybackMs;
      const durationMs = finishedTrack && Number(finishedTrack.duration) > 0 ? Number(finishedTrack.duration) * 1000 : 0;
      const manualSkip = reason === "skip" || reason === "stop" || reason === "previous";
      const endedUnexpectedly = Boolean(finishedTrack) && !manualSkip && durationMs > 0 && totalPlaybackMs + 1500 < durationMs;

      if (endedUnexpectedly) {
        this.currentTrackRetries += 1;
        if (this.currentTrackRetries <= 2) {
          // 마지막으로 알려진 위치에서 같은 트랙 재개 시도
          await this.play(null, totalPlaybackMs);
          return;
        } else {
        }
      } else {
        this.currentTrackRetries = 0;
      }

      if (!finishedTrack) {
        this.resource = null;
        return;
      }

      this.previousTracks.push(finishedTrack);
      if (this.previousTracks.length > 50) this.previousTracks.shift();

      // 참조 해제 (파일은 디스크에 유지 — 제거는 CacheManager가 처리)
      this.currentDownloadedFile = null;

      if (this.loop === "track" && !manualSkip) {
        // 트랙 반복은 처음부터 재생 (사용자가 명시적으로 스킵한 경우 제외)
        await this.play(null, 0);
        return;
      }

      if (this.loop === "queue") {
        this.queue.push(finishedTrack);
      }

      this.resource = null;
      this.expectedTrackEndTs = null;
      this.startTime = null;
      this.pausedTime = 0;
      this.lastPlaybackPosition = 0;
      this.currentTrackStartOffsetMs = 0;
      this.currentTrackCache = null;

      if (this.queue.length > 0) {
        if (this.nextFromFront) {
          // jump-to / previous / playfirst가 이 트랙을 의도적으로 맨 앞에 두었으므로 셔플이 켜져 있어도 이를 존중
          this.nextFromFront = false;
          this.currentTrack = this.queue.shift();
        } else if (this.shuffle) {
          const randomIndex = Math.floor(Math.random() * this.queue.length);
          this.currentTrack = this.queue.splice(randomIndex, 1)[0];
        } else {
          this.currentTrack = this.queue.shift();
        }

        // 다음 트랙을 처음부터 재생
        await this.play(null, 0);

        if (this.guild?.client?.musicEmbedManager) {
          await this.guild.client.musicEmbedManager.updateNowPlayingEmbed(this);
        }

        return;
      }

      if (this.autoplay) {
        const genres = require("../config/genres");
        if (genres[this.autoplay]) {
          this.currentTrackRetries = 0;
          await this.handleAutoplay();
          return;
        }
        // 알 수 없는 장르(장르 목록 변경 전에 저장된 세션 등) — 자동재생을 끄고 알린 뒤, 아래의 일반 대기열 종료 흐름으로 진행
        console.warn(`⚠️ 알 수 없는 자동재생 장르 '${this.autoplay}' — 자동재생을 끕니다`);
        if (this.textChannel) {
          this.textChannel.send(`❌ 자동재생 장르 \`${this.autoplay}\`(을)를 찾을 수 없어 자동재생을 껐습니다. \`/autoplay\`로 다시 설정해 주세요.`).catch(() => {});
        }
        this.autoplay = false;
      }

      this.currentTrack = null;
      this.currentTrackCache = null;
      this.currentTrackStartOffsetMs = 0;

      this.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});

      if (this.guild?.client?.musicEmbedManager) {
        await this.guild.client.musicEmbedManager.handlePlaybackEnd(this);
      } else {
        await this.showQueueCompleted();
      }

      this.clearInactivityTimer(false);
      if (this.guild?.id) {
        CacheManager.removePlayerSession(this.guild.id);
      }

      setTimeout(() => {
        if (this.queue.length === 0 && !this.currentTrack) {
          this.cleanup();
          const clientInstance = this.guild?.client;
          if (clientInstance?.players) {
            clientInstance.players.delete(this.guild.id);
          }
        }
      }, config.bot.leaveDelayQueueEmptyMs);
    } finally {
      this.isTransitioning = false;
      this.skipRequested = false;
      this.stopRequested = false;
      this.pendingEndReason = null;
    }
  }

  async handleAutoplay() {
    if (!this.autoplay || typeof this.autoplay !== "string") return;

    try {
      // 장르 정의는 config/genres.js 한 곳에서 관리.
      // 알 수 없는 장르는 호출부(handleTrackEnd)에서 걸러지므로 여기서는 방어적으로 중단만 한다.
      const genres = require("../config/genres");
      const keywords = genres[this.autoplay]?.keywords;
      if (!keywords) return;
      const randomKeyword = keywords[Math.floor(Math.random() * keywords.length)];

      // 임의 트랙을 YouTube에서 검색
      const YouTube = require("./YouTube");
      const results = await YouTube.search(randomKeyword, 15, this.guild.id);

      if (!results || results.length === 0) {
        return;
      }

      // 비음악 콘텐츠 필터링
      const filteredResults = results.filter((track) => {
        // 길이가 없으면 건너뜀
        if (!track.duration) return false;

        // 길이 제한: 30초 ~ 10분(600초)
        // 이를 통해 대부분의 튜토리얼, 강의, 팟캐스트 및 전체 영화를 걸러냅니다.
        if (track.duration < 30 || track.duration > 600) return false;

        // 제목에서 일반적인 비음악 키워드 필터링
        const title = (track.title || "").toLowerCase();
        const blockedKeywords = ["tutorial", "lesson", "course", "learn", "learning", "podcast", "interview", "talk", "speech", "lecture", "review", "unboxing", "reaction", "gameplay", "full movie", "full album", "full episode", "documentary", "how to", "guide", "tips", "tricks", "vlog", "practice", "exercise", "workout", "meditation", "asmr", "story", "audiobook", "mix |", "compilation"];

        // 제목에 차단 키워드가 포함되어 있는지 확인
        const hasBlockedKeyword = blockedKeywords.some((keyword) => title.includes(keyword));
        if (hasBlockedKeyword) return false;

        // 재생목록처럼 보이는 콘텐츠 필터링 (믹스와 모음은 이모지나 괄호가 많은 경우가 잦음)
        const emojiCount = (title.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
        const bracketCount = (title.match(/[\[\]【】]/g) || []).length;
        if (emojiCount > 3 || bracketCount > 4) return false;

        return true;
      });

      if (filteredResults.length === 0) {
        // 다른 키워드로 다시 시도
        const fallbackKeyword = keywords[Math.floor(Math.random() * keywords.length)];
        const fallbackResults = await YouTube.search(fallbackKeyword, 10, this.guild.id);
        const fallbackFiltered = (fallbackResults || []).filter((track) => track.duration >= 30 && track.duration <= 600);

        if (fallbackFiltered.length === 0) {
          return;
        }

        filteredResults.push(...fallbackFiltered);
      }

      // 필터링된 결과에서 임의 트랙 선택
      const randomTrack = filteredResults[Math.floor(Math.random() * filteredResults.length)];
      randomTrack.requestedBy = this.guild.members.me.user;
      randomTrack.addedAt = Date.now();

      // 대기열에 추가
      this.queue.push(randomTrack);

      // 트랙 사전 로드
      this.preloadTrack(randomTrack).catch((err) => {
        if (err && err.message) {
          console.error(`❌ Autoplay preload failed: ${err.message}`);
        }
      });

      // 처음부터 재생 시작
      this.currentTrack = this.queue.shift();
      await this.play(null, 0);

      // 자동재생 트랙용 현재 재생 임베드 갱신
      if (this.guild?.client?.musicEmbedManager) {
        await this.guild.client.musicEmbedManager.updateNowPlayingEmbed(this);
      }
    } catch (error) {
      console.error("❌ Autoplay error:", error.message);
    }
  }

  async handleError(error, userMessage = null) {
    // 오류 시 다음 트랙으로 스킵 시도
    if (this.queue.length > 0) {
      // 스킵 전에 오류를 텍스트 채널로 전송
      if (userMessage && this.textChannel) {
        try {
          await this.textChannel.send(userMessage);
        } catch (_) {}
      }
      this.currentTrack = this.queue.shift();
      await this.play(null, 0);
    } else {
      this.currentTrack = null;
      const msg = userMessage || "❌ 오류가 발생하여 재생목록이 중지되었습니다.";
      if (this.textChannel) {
        try {
          await this.textChannel.send(msg);
        } catch (_) {}
      }
    }
  }

  async showQueueCompleted() {
    if (!this.nowPlayingMessage || !this.textChannel) return;

    try {
      const embed = new EmbedBuilder().setTitle("✅ 대기열 완료").setDescription("모든 트랙이 재생되었습니다! `/play` 명령을 사용하여 새 트랙을 추가하세요.").setColor("#00ff00").setTimestamp();

      // 존재하지 않는 this.createControlButtons 호출 제거 (2026-07-07) — 이 폴백 경로는 embedManager 부재 시에만 도달하며, 기존에는 항상 TypeError로 catch에 떨어졌음
      await this.nowPlayingMessage.edit({
        embeds: [embed],
        components: [],
      });
    } catch (error) {
      // 메시지가 삭제되었을 수 있으므로 참조 정리
      this.nowPlayingMessage = null;
    }
  }

  // ── 세션 영속화 — 로직은 SessionPersistence ────────────────────────────────

  restoreFromState(state) {
    return this.persistence.restoreFromState(state);
  }

  persistState(reason = "manual", immediate = false) {
    return this.persistence.persistState(reason, immediate);
  }

  startStateSync() {
    this.persistence.startStateSync();
  }

  stopStateSync() {
    this.persistence.stopStateSync();
  }

  scheduleStatePersist(reason = "update", delay = 200) {
    this.persistence.scheduleStatePersist(reason, delay);
  }

  cleanup(isShutdown = false) {
    try {
      if (!isShutdown) {
        this.updateVoiceStatus("").catch(() => {});
      }

      this.clearInactivityTimer(false);
      this.stopStateSync();

      // 종료 중에는 정리 전에 상태 저장
      if (isShutdown && this.guild?.id) {
        this.persistState("shutdown").catch(() => {});
      } else if (this.guild?.id) {
        CacheManager.removePlayerSession(this.guild.id);
      }

      if (!isShutdown) {
        this.currentDownloadedFile = null;
        this.downloadedFiles.clear();
      }

      // 복구 시스템 중지
      this.voice.stopConnectionRecovery();

      // 상태 확인 타이머 정리
      if (this.connectionHealthCheck) {
        clearInterval(this.connectionHealthCheck);
        this.connectionHealthCheck = null;
      }

      // 트랙 타이머 정리
      if (this.trackTimer) {
        clearTimeout(this.trackTimer);
        this.trackTimer = null;
      }

      // 오디오 플레이어 중지
      if (this.audioPlayer) {
        this.audioPlayer.stop();
        this.audioPlayer.removeAllListeners();
      }

      // 음성 채널 연결 해제
      if (this.connection) {
        this.connection.removeAllListeners();
        if (this.connection.state && this.connection.state.status !== "destroyed") {
          try {
            this.connection.destroy();
          } catch (error) {
            console.error("Error destroying connection:", error);
          }
        }
        this.connection = null;
      }

      // 리소스 정리
      if (this.resource) {
        try {
          this.resource.playStream.destroy();
        } catch (e) {
          // 스트림이 이미 제거되었을 수 있음
        }
        this.resource = null;
      }

      // 사전 로드된 스트림 정리
      this.preloadedStreams.clear();
      this.preloadingQueue = [];

      // 플레이어 데이터 정리
      this.queue = [];
      this.releaseAudioProtection();
      this.currentTrack = null;
      this.previousTracks = [];
      this.startTime = null;
      this.pausedTime = 0;
      this.currentTrackCache = null;
      this.activeStreamInfo = null;

      // 복구 데이터 정리
      this.isRecovering = false;
      this.recoveryAttempts = 0;
      this.lastPlaybackPosition = 0;
      this.currentTrackStartOffsetMs = 0;
      this.nextFromFront = false;

      // UI 참조 정리
      this.nowPlayingMessage = null;
      this.requesterId = null;
      this.voiceChannel = null;
      const embedManager = this.guild?.client?.musicEmbedManager;
      if (embedManager && this.textChannel?.id) {
        embedManager.deleteWebhookCache(this.textChannel.id);
      }
      this.textChannel = null;

      // 일시정지 상태 재설정
      this.pauseReasons.clear();
      this.paused = false;
    } catch (error) {
      console.error("❌ Error during cleanup:", error);
    }
  }

  async updateVoiceStatus(status) {
    try {
      const channel = this.voiceChannel ? this.guild.channels.cache.get(this.voiceChannel.id) : null;
      if (!channel) return;

      const perms = channel.permissionsFor(this.guild.members.me);
      if (!perms?.has(PermissionFlagsBits.SetVoiceChannelStatus)) return;

      if (!this._voiceStatusOwned) {
        // 캐시는 신뢰할 수 없음 — API에서 실제 상태 가져오기
        let currentStatus = "";
        try {
          const data = await this.guild.client.rest.get(`/channels/${channel.id}`);
          currentStatus = typeof data.status === "string" ? data.status : "";
        } catch {
          return;
        }
        if (!isBotOwnedStatus(currentStatus)) return;
      }

      await this.guild.client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: status ?? "" } });
      this._voiceStatusOwned = !!status;
    } catch {
      // 중요하지 않음
    }
  }

  getStatus() {
    return {
      connected: !!this.connection,
      playing: this.audioPlayer?.state?.status === AudioPlayerStatus.Playing,
      paused: this.audioPlayer?.state?.status === AudioPlayerStatus.Paused,
      queue: this.queue.length,
      volume: this.volume,
      loop: this.loop,
      shuffle: this.shuffle,
      currentTrack: this.currentTrack,
      voiceChannel: this.voiceChannel?.name,
      textChannel: this.textChannel?.name,
    };
  }
}

module.exports = MusicPlayer;
