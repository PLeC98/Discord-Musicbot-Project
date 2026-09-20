const { AudioPlayerStatus, createAudioPlayer, createAudioResource, StreamType } = require("@discordjs/voice");
const log = require("./logger").child({ category: "player" });
// 워치독·상태 전이는 재생 로그와 섞이면 묻힌다 — 대시보드에서도 별도 필터가 생긴다
const wlog = require("./logger").child({ category: "watchdog" });
// 사용자·대시보드가 일으킨 조작. 워치독 분석에서 "사람이 넘긴 것"과 "봇이 자른 것"을 갈라야 한다
const clog = require("./logger").child({ category: "control" });
const { PermissionFlagsBits } = require("discord.js");

const config = require("../config");
const autoplayRoute = require("./autoplayRoute");
const ErrorHandler = require("./ErrorHandler");
const TrackResolver = require("./TrackResolver");
const SponsorBlock = require("./SponsorBlock");
const SponsorSkipper = require("./SponsorSkipper");
const DirectLink = require("./DirectLink");
const { openChunkedStream, contentLengthFromUrl, describeStreamError } = require("./chunkedStream");
const { AudioSplicer } = require("./audioSplicer");
const voiceChannelStatus = require("./voiceChannelStatus");
const CacheManager = require("./CacheManager");
const VoiceConnectionManager = require("./VoiceConnectionManager");
const TrackDownloader = require("./TrackDownloader");
const createPlayerSessionId = require("./playerSessionId");
const SessionPersistence = require("./SessionPersistence");
const QueueWarmer = require("./QueueWarmer");
const trackState = require("./trackState");
const S = require("./strings");
const { spawnFfmpeg } = require("./ffmpegProcess");
const { capabilities: ffmpegCapabilities } = require("./ffmpegPath");
const { Readable } = require("stream");
const fsSync = require("fs");

// 무이음 전환 상수 — .env로 빼지 않는다. 자연스러운 값의 범위가 좁게 정해져 있어
// 사용자가 조정해서 나아질 여지가 없다.
const SWITCH_LEAD_MS = 2000; // 전환 지점을 현재보다 얼마나 앞에 잡는가 (캐시 디코더 기동 실측 43ms)
const SWITCH_FADE_MS = 40; // 등출력 크로스페이드 길이
const MAX_TRACK_RETRIES = 2; // 끊긴 곡을 끊긴 위치부터 다시 트는 횟수
const MAX_LIVE_REOPENS = 5; // 라이브가 끊겼을 때 주소를 새로 받아 다시 여는 횟수
const LIVE_REOPEN_DELAY_MS = 1000; // 재시도 간격의 단위. 시도 횟수에 비례해 늘린다
const BUFFERING_STALL_MS = 15_000; // 버퍼링 중 입력이 이만큼 없으면 다시 시도
// 안 정하면 libopus 기본값(실측 100k)으로 나간다. 캐시가 128k 라 거기에 맞춘다.
// 더 올릴 수는 있지만 prism 래퍼가 128k 에서 자르고, 청취로도 그 위는 구분되지 않았다.
const SEND_BITRATE = 128_000;
// HLS 세그먼트 하나가 실패하면 기본값(0)으로는 재시도 없이 스트림이 죽는다.
const SEG_MAX_RETRY = 5;

const sec = (ms) => (ms == null ? "?" : (ms / 1000).toFixed(1));

class MusicPlayer {
  constructor(guild, textChannel, voiceChannel) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;

    // 오디오 플레이어 설정
    this.audioPlayer = createAudioPlayer();
    this.connection = null;
    this.resource = null;

    // 대기열 관리 — 현재곡·대기열·기록은 trackState로만 바꾼다
    trackState.init(this);
    // 캐시 퇴거 보호 중인 audioSourceKey — currentTrack과 별도로 기억,
    // 종료 경로가 currentTrack을 먼저 null해도 해제가 누락되지 않게
    this._protectedAudioKey = null;

    // 플레이어 설정
    this.volume = config.bot.defaultVolume;
    this.loop = false; // false, 'track', 'queue' 중 하나
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

    // 음성 연결 복구 시스템
    this.isRecovering = false;
    this.maxRecoveryAttempts = 5;
    this.recoveryAttempts = 0;
    this.recoveryInterval = null;
    this.connectionHealthCheck = null;
    this.queueEmptyTimer = null;

    // 재생 생명주기 상태
    this.trackTimer = null;
    this.isTransitioning = false;
    this.pendingEndReason = null;
    this.currentTrackRetries = 0;
    this.skipRequested = false;
    this.stopRequested = false;
    this.isPlayStarting = false; // play() 셋업 진행 중 — 워처 자동 스킵 재진입 방지
    this.expectedTrackEndTs = null;
    this.currentTrackCache = null;
    this.activeStreamInfo = null;
    this.lastPlaybackPosition = 0;
    this.currentTrackStartOffsetMs = 0;

    // 음성 채널 상태 소유권

    // 일시정지 관리
    this.pauseReasons = new Set();

    // 비활성 타임아웃
    this.inactivityTimer = null;
    this.inactivityTimeoutMs = config.bot.leaveDelayAloneMs;

    // 로컬 파일 캐싱
    this.currentDownloadedFile = null; // 현재 재생 중인 다운로드 파일 경로

    // 협력 모듈 — 로직 분리 (상태 필드는 전부 이 인스턴스에 유지)
    this.voice = new VoiceConnectionManager(this);
    this.downloader = new TrackDownloader(this);
    this.persistence = new SessionPersistence(this);
    this.trackSink = this.persistence; // trackState가 바뀐 것을 저장으로 알린다
    this.warmer = new QueueWarmer(this, {
      warm: (track) => this.downloader.warm(track),
      isCached: (track) => this.downloader.isCached(track),
      isBusy: (track) => TrackDownloader.isDownloading(this.downloader.trackFilePath(track)),
      keyOf: (track) => TrackResolver.ensureAudioSourceKey(track),
      setProtection: (guildId, keys) => CacheManager.setQueuedKeys(guildId, keys),
    });
    this.sponsorSkipper = new SponsorSkipper(this);

    // 이벤트 설정
    this.setupEvents();
  }

  setupEvents() {
    // 오디오 플레이어 이벤트
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      // pause()는 재생 중일 때만 먹는다. 버퍼링 중에 걸린 일시정지는 재생으로 넘어오는 이 순간에 건다.
      if (this.pauseReasons.size > 0) {
        this.audioPlayer.pause();
        return;
      }
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

    // 내장 방어(maxMissedFrames)는 Playing 중에만 돈다. Buffering에서 멈추면 시작 워치독이 깨운다.
    // 전이 자체는 정상 동작이라 debug, 버퍼링이 3초를 넘기면 warn.
    this.audioPlayer.on("stateChange", (oldState, newState) => {
      if (oldState.status === newState.status) return;

      if (oldState.status === AudioPlayerStatus.Buffering) {
        const heldMs = this._bufferingSince ? Date.now() - this._bufferingSince : null;
        this._clearBufferingWatch();
        if (heldMs !== null) {
          const line = `상태 전이: buffering → ${newState.status} | ${this._trackLabel()} | 버퍼링 ${(heldMs / 1000).toFixed(1)}s`;
          if (heldMs >= 3000) wlog.warn(`${line} 오래 걸림`);
          else wlog.debug(line);
        }
        return;
      }

      wlog.debug(`재생 상태 전이: ${oldState.status} → ${newState.status} | ${this._trackLabel()}`);

      if (newState.status === AudioPlayerStatus.Buffering) this._startBufferingWatch();
    });

    this.audioPlayer.on("error", (error) => {
      log.error("오디오 플레이어 오류:", error);

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

  // ── 다운로드/사전 로드 — 로직은 TrackDownloader ──────────────────────────

  async play(_trackIndex = null, seekMs = 0) {
    // 재진입 가드 — play()가 셋업(스트림/다운로드) 중일 때 워처의 자동 스킵 seek가
    // 겹쳐 들어오면 비캐시 곡의 재생이 깨진다(버그). isPlayStarting 동안 워처는 발동을 미룬다.
    this.isPlayStarting = true;
    try {
      // 현재 트랙이 없으면 대기열에서 가져오기
      if (!this.currentTrack) {
        if (this.queue.length === 0) {
          return { success: false, message: "대기열에 트랙이 없습니다!" };
        }
        trackState.shiftNext(this);
      }

      // 연결되어 있지 않으면 음성 채널에 연결
      if (!this.connection) {
        const connected = await this.connect();
        if (!connected) {
          return { success: false, message: "음성 채널에 연결하지 못했습니다!" };
        }
      }

      // 신규 재생(seek 아님)이면, 스트림 셋업 전에 videoId+SponsorBlock을 먼저 확보해
      // 인트로 구간을 초기 오프셋으로 반영한다(무갭 — 0부터 틀고 seek하는 이중재생 회피).
      // 흐름: (spotify면) youtube 해석 → SponsorBlock 조회 → 인트로 있으면 오프셋, 없으면 그대로.
      if ((Number(seekMs) || 0) === 0) {
        try {
          await SponsorBlock.ensureForTrack(this.currentTrack, this.guild.id);
          if (!this.currentTrack._sponsorResolved && this.currentTrack.platform === "spotify") {
            await TrackResolver.findYouTubeEquivalent(this.currentTrack); // 멱등 — videoId 확정
            await SponsorBlock.ensureForTrack(this.currentTrack, this.guild.id);
          }
          const introEnd = this._introOffsetMs(this.currentTrack);
          if (introEnd > 0) seekMs = introEnd;
        } catch {
          /* 조회 실패는 무시(fail-open) — 오프셋 없이 재생 */
        }
      }

      // 새 재생을 위해 생명주기 플래그 재설정
      this.pendingEndReason = null;
      this.skipRequested = false;
      this.stopRequested = false;
      this._playingLive = false; // 이번 재생이 라이브 갈래인가. 종료 처리가 재연결 여부를 이걸로 가른다
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

      if (this.currentDownloadedFile && fsSync.existsSync(this.currentDownloadedFile) && !TrackDownloader.isDownloading(this.currentDownloadedFile)) {
        downloadedFile = this.currentDownloadedFile;
      } else if (this.currentTrack.audioSourceKey) {
        const _earlyPath = this.currentTrack._cachedFilePath || CacheManager.getFilePath(this.currentTrack.audioSourceKey);
        if (fsSync.existsSync(_earlyPath) && !TrackDownloader.isDownloading(_earlyPath)) {
          const _earlyStats = fsSync.statSync(_earlyPath);
          if (_earlyStats.size > 0) {
            downloadedFile = _earlyPath;
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

      if (!streamInfo && !downloadedFile) {
        // spotify는 YouTube 동등물을 먼저 확보 — 검색으로 audioSourceKey가 정해지므로
        // 캐시 파일을 한 번 더 확인해 있으면 스트림 획득을 통째로 건너뜀
        if (this.currentTrack.platform === "spotify") {
          const ytUrl = await TrackResolver.findYouTubeEquivalent(this.currentTrack);
          if (!ytUrl) {
            throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${this.currentTrack.title}`);
          }
          if (this.currentTrack.audioSourceKey) {
            const _spotPath = CacheManager.getFilePath(this.currentTrack.audioSourceKey);
            if (fsSync.existsSync(_spotPath) && fsSync.statSync(_spotPath).size > 0) {
              downloadedFile = _spotPath;
              this.currentDownloadedFile = _spotPath;
            }
          }
        }

        // 일반 방식으로 스트림 가져오기 (플랫폼 스위치는 TrackResolver 한 곳에서)
        if (!downloadedFile) {
          streamInfo = await TrackResolver.getStream(this.currentTrack, resumeFromSeconds);
        }
      }

      if (!streamInfo && !downloadedFile) {
        throw new Error("오디오 스트림 가져오기 실패");
      }

      // 재생목록으로 담은 곡은 재생목록 페이지가 준 제목을 쓰고 있는데, 같은 영상인데도 다를 수 있다.
      // 스트림을 가져왔다면 그 응답에 영상 자체의 제목이 실려 있으므로 왕복 없이 고칠 수 있다.
      // (캐시로 재생하는 곡은 여기를 지나지 않는다 — 그쪽은 받을 때 고친다.)
      // 스포티파이 트랙은 제외한다: 유튜브 동등물의 제목은 다른 문자열이고, 사용자가 넣은 것은
      // 스포티파이 곡이므로 표시는 그쪽이 맞다.
      let titleVerified = false;
      if (this.currentTrack.platform === "youtube" && streamInfo && typeof streamInfo === "object" && streamInfo.title) {
        titleVerified = true;
        if (streamInfo.title !== this.currentTrack.title) {
          log.debug(`제목 교정: "${this.currentTrack.title}" → "${streamInfo.title}"`);
          this.currentTrack.title = streamInfo.title;
        }
      }

      // SponsorBlock 구간 데이터 확보 (첫곡/캐시곡 포함 — preload를 거치지 않았을 수 있음).
      // 이 시점엔 videoId가 확정(youtube id / 해석된 youtubeUrl / audioSourceKey yt:)됨. 실패해도 재생 진행.
      try {
        await SponsorBlock.ensureForTrack(this.currentTrack, this.guild.id);
      } catch {
        /* 무시 */
      }
      // 자동 스킵 워처 가동 — 구간 있으면 시작, seek면 기준점을 seek 지점으로 리셋(수동 진입 허용)
      this.sponsorSkipper.onPlayStart(resumeFromMs);

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

      // 지금 라이브인지는 yt-dlp 응답이 정본이다. 대기열에 담길 때 방송 중이었어도 그사이 끝나
      // 다시보기가 됐을 수 있고, 반대로 라이브인 줄 모르고 담긴 것도 있다(재생목록·믹스).
      // 탐색·반복·종료 감시·표시가 전부 이 값을 읽으므로 여기서 한 번 맞춰 둔다.
      if (streamInfo && typeof streamInfo === "object" && "liveStatus" in streamInfo) {
        this.currentTrack.liveStatus = streamInfo.liveStatus;
        this.currentTrack.isLive = streamInfo.liveStatus === "is_live";
      } else if (downloadedFile) {
        // 캐시 파일이 있다는 것은 끝이 있는 음원이라는 뜻이다. 라이브는 받지 않는다.
        this.currentTrack.isLive = false;
      }

      // HLS는 파이프로 먹일 수 없다. 재생목록 안이 상대 경로뿐이라 ffmpeg가 기준 위치를 알아야 하고,
      // 세그먼트도 스스로 받아 와야 한다. 주소를 주는 갈래는 여기뿐이다.
      const useUrlInput = !downloadedFile && typeof streamUrl_final === "string" && MusicPlayer.isHlsStream(streamInfo);
      const isLiveStream = useUrlInput && streamInfo?.liveStatus === "is_live";

      // 플래그: 스트림은 있지만 캐시 파일이 없으면 다운로드 필요.
      // 라이브만 예외다. 끝이 없어서 받기 시작하면 파일이 무한히 분다.
      if (!downloadedFile && !isLiveStream) shouldDownload = true;

      if (useUrlInput) {
        // 입구(playRequest)와 사운드클라우드 포맷 선택이 먼저 거르지만, 여기까지 온 것은 막는다.
        if (!ffmpegCapabilities().ok) {
          throw new Error("이 ffmpeg 빌드로는 HLS 스트림을 재생할 수 없습니다");
        }

        // 라이브가 아닌 HLS(사운드클라우드 등)는 평소대로 캐시를 받아 둔다. 재생은 기다리지 않는다.
        if (shouldDownload) this._startBackgroundDownload();
        shouldDownload = false;

        const ffmpeg = spawnFfmpeg(MusicPlayer.buildFfmpegArgs({ url: streamUrl_final, seekMs: isLiveStream ? 0 : resumeFromMs }), "stream");
        // 캐시 전환(AudioSplicer)은 걸지 않는다. 라이브는 갈아탈 캐시가 없고, 잔끊김은
        // ffmpeg의 재접속이 먹는다. 거기서도 못 살리면 종료 코드로 갈라 다시 연다(handleTrackEnd).
        this._playingLive = isLiveStream;
        this._liveExitCode = null;
        ffmpeg.once("exit", (code, signal) => {
          this._liveExitCode = code === null && signal ? -1 : code;
        });

        // 파이프 갈래는 Node가 받는 바이트로 정체를 재지만 여기엔 그 스트림이 없다.
        // ffmpeg 출력이 곧 "살아 있다"의 증거다.
        this._inputToken = null;
        this._inputProgressAt = null;
        const inputToken = {};
        this._inputToken = inputToken;
        ffmpeg.stdout.on("data", () => {
          if (this._inputToken === inputToken) this._inputProgressAt = Date.now();
        });

        this.resource = createAudioResource(ffmpeg.stdout, {
          inputType: StreamType.Raw,
          inlineVolume: true,
          metadata: {
            title: this.currentTrack.title,
            url: this.currentTrack.url,
            duration: isLiveStream ? 0 : streamInfo.duration || this.currentTrack.duration,
            bitrate: streamInfo.bitrate || 128,
          },
        });
      }

      // 다운로드가 필요하면 백그라운드 다운로드와 동시에 즉시 스트리밍 시작
      if (shouldDownload) {
        const filepath = this.downloader.trackFilePath(this.currentTrack);
        this._startBackgroundDownload();

        // 다운로드 완료를 기다리지 않고 즉시 스트리밍. 이 갈래에서는 네트워크를 Node가 담당하고
        // ffmpeg에는 pipe로만 넣는다. URL을 직접 주면 yt-dlp가 준 httpHeaders가 빠지고, 아래 실패
        // 폴백을 건너뛰며, 재생이 ffmpeg 빌드의 네트워크 스택에 의존한다(정적 빌드는 SIGSEGV로 죽는다).
        // 그래서 URL 입력은 그렇게 할 수밖에 없는 HLS 갈래에만 두었다.
        let audioStream;
        // 청크 스트림이 끊겼을 때 부를 훅 — 스플라이서가 아래에서 만들어진 뒤 채운다
        const streamHooks = { interrupt: () => false, resumed: () => {} };
        if (typeof streamInfo === "object" && streamInfo.stream) {
          audioStream = streamInfo.stream;
        } else if (typeof streamUrl_final === "string") {
          try {
            // 트랙의 platform이 아니라 서술자를 본다 — AnimeThemes처럼 출처 이름을 platform에
            // 쓰면서 음원을 직접 받는 곡이 있다(TrackResolver.getStream이 direct 서술자를 돌려준다).
            if (streamInfo?.platform === "direct" || this.currentTrack.platform === "direct") {
              // 직접 링크는 SSRF 가드(SafeUrl)를 통과해 스트림을 연다
              audioStream = await DirectLink.getStream(streamUrl_final);
            } else {
              // 오프셋 재생이면 begin= 없는 원본 URL을 받아 `-ss`가 단독으로 위치를 정하게 한다(이중 seek 방지).
              const fetchUrl = resumeFromMs > 0 && streamInfo?.rawUrl ? streamInfo.rawUrl : streamUrl_final;
              const reqHeaders = streamInfo?.httpHeaders || {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              };

              // 전체 길이를 알면 Range로 나눠 받는다 — 순차 GET은 서버가 재생시간의 약 2배속으로 조인다.
              // 길이를 모르는 입력은 나눌 수가 없으므로 예전 방식 그대로.
              const totalBytes = contentLengthFromUrl(fetchUrl);
              if (totalBytes) {
                // await로 첫 요청까지 여기서 끝낸다 — 실패가 아래 catch의 캐시 폴백으로 가도록
                audioStream = await openChunkedStream({
                  url: fetchUrl,
                  headers: reqHeaders,
                  totalBytes,
                  chunkSize: config.stream.chunkBytes,
                  onInterrupt: (err) => streamHooks.interrupt(err),
                  onResumed: (info) => streamHooks.resumed(info),
                });
              } else {
                const response = await fetch(fetchUrl, { headers: reqHeaders });

                if (!response.ok) throw new Error(`Failed to fetch stream: ${response.status}`);

                audioStream = typeof response.body?.getReader === "function" && typeof Readable.fromWeb === "function" ? Readable.fromWeb(response.body) : response.body;
              }
            }
          } catch (fetchError) {
            // 스트리밍 실패 — 위에서 시작한 백그라운드 다운로드로 폴백
            if (fsSync.existsSync(filepath) && fsSync.statSync(filepath).size > 0) {
              // 이미 완료됨
              shouldDownload = false; // 파일 모드로 전환
              downloadedFile = filepath;
            } else {
              const inFlight = TrackDownloader.waitFor(filepath);
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

        this._inputToken = null;
        this._inputProgressAt = null;

        // 스트리밍에 실패했고 다운로드 파일이 있으면 파일 재생으로 건너뜀
        if (!audioStream && downloadedFile) {
          shouldDownload = false; // 파일 재생으로 이어서 진행
        } else if (audioStream) {
          const ffmpeg = spawnFfmpeg(MusicPlayer.buildFfmpegArgs({ seekMs: resumeFromMs }), "stream");
          // 오류는 트랙이 바뀐 뒤에 도착할 수 있다 — 그때 이 핸들러가 현재 트랙을 보면 엉뚱한 곡의
          // 캐시로 전환한다. 이 재생이 어느 트랙의 것이었는지 붙잡아 둔다.
          const playingTrack = this.currentTrack;

          // 소스를 갈아끼울 수 있게 리소스 아래에 Splicer를 둔다. 스트림이 죽으면 AudioPlayer를
          // 거치지 않고 캐시 파일로 넘어가므로 공백이 들리지 않는다(_planCacheSwitch).
          const playSource = new AudioSplicer(ffmpeg.stdout, { fadeMs: SWITCH_FADE_MS });

          const streamDetail = () => {
            const st = audioStream.stats?.();
            return st ? `청크 #${st.requests} · ${st.received}/${st.totalBytes}B · 마지막 수신 ${sec(st.idleMs)}초 전 · URL 만료 ${st.expiresInS ?? "?"}초 후` : "단일 GET";
          };
          // 끊기면 캐시 전환을 먼저 시도한다. 예약되면 청크 스트림은 이어받지 않고 받아 둔 데까지만 흘린다
          streamHooks.interrupt = (err) => {
            log.debug(`스트림 중단: ${describeStreamError(err)} | ${streamDetail()}`);
            return playSource !== ffmpeg.stdout && this._planCacheSwitch(playSource, playingTrack);
          };
          streamHooks.resumed = ({ attempts, downtimeMs, starvedMs }) => {
            const line = `스트림 이어받음: ${this._trackLabel(playingTrack)} | 재시도 ${attempts}회, ${sec(downtimeMs)}초`;
            if (starvedMs > 0) log.warn({ tags: ["retry"] }, `${line} — 그동안 공급이 ${sec(starvedMs)}초 끊겼습니다`);
            else log.info({ tags: ["retry", "recovered"] }, line);
          };
          // 이어받기로도 못 살렸다. ffmpeg 입력을 닫아야 출력이 끝나 예약된 전환이나 Idle(→ 끊긴 위치부터 재개)로 넘어간다
          audioStream.on("error", (err) => {
            log.debug(`스트림 중단(복구 불가): ${describeStreamError(err)} | ${streamDetail()}`);
            if (playSource !== ffmpeg.stdout) this._planCacheSwitch(playSource, playingTrack);
            if (!ffmpeg.stdin.destroyed && !ffmpeg.stdin.writableEnded) ffmpeg.stdin.end();
          });
          // ffmpeg가 끝나면 입력 스트림도 닫는다 — .pipe 바깥이라 자동 정리 대상이 아니다.
          ffmpeg.once("exit", () => audioStream.destroy());
          audioStream.pipe(ffmpeg.stdin);
          // pipe 뒤에 붙인다 — 먼저 붙이면 흐르기 시작한 데이터가 목적지 없이 버려진다
          const inputToken = {};
          this._inputToken = inputToken;
          audioStream.on("data", () => {
            if (this._inputToken === inputToken) this._inputProgressAt = Date.now();
          });

          this.resource = createAudioResource(playSource, {
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
        const ffmpeg = spawnFfmpeg(MusicPlayer.buildFfmpegArgs({ file: downloadedFile, seekMs: resumeFromMs }), "playback");

        this.resource = createAudioResource(ffmpeg.stdout, {
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
      this.resource.encoder?.setBitrate(SEND_BITRATE);

      const audioDurationSec = this._audioDurationSec(streamInfo, downloadedFile);
      if (audioDurationSec) this.currentTrack.duration = audioDurationSec;

      log.info(`재생: ${this.currentTrack.title} (${this.currentTrack.duration}s, offset: ${resumeFromMs}ms, 출처=${downloadedFile ? "캐시" : "스트림"})`);

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

      // 재생 통계와 소스 URL → audioSourceKey 매핑을 DB에 기록.
      // 부기일 뿐이므로 실패해도 재생을 끌어내리지 않는다 — 여기서 던지면 방금 시작한 소리가 catch에서 멈춘다.
      //
      // 라이브는 캐시 장부에 낄 자리가 없다. `track_lookup.audio_source_key`가 `audio_cache`를
      // 참조하는데 라이브는 받지 않으므로 그 행이 영영 생기지 않는다(외래 키 위반).
      if (this.currentTrack.audioSourceKey && !this.currentTrack.isLive) {
        try {
          CacheManager.recordPlayback(this.currentTrack.audioSourceKey);
          CacheManager.recordTrackLookup(this.currentTrack.url, this.currentTrack.platform, this.currentTrack.audioSourceKey, this.currentTrack.title, this.currentTrack.artist, this.currentTrack.thumbnail, { verified: titleVerified });
        } catch (error) {
          log.warn(`캐시 장부 기록 실패(재생은 계속): ${error?.message || error}`);
        }
      }

      if (this.pauseReasons.size > 0) {
        // 멈추는 건 Playing 리스너다 — 지금은 아직 버퍼링이라 pause()가 먹지 않는다
        log.info(`곡을 불러와 일시정지 상태로 둠: 원인=${Array.from(this.pauseReasons).join(", ")}`);
        this.paused = true;
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
      this.warmer.start();
      await this.persistState(resumeFromMs > 0 ? "resume-playback" : "play");

      // 다음 자동재생 곡을 미리 뽑아 둔다(B-50). 기다리지 않는다 — 재생 시작을 늦추면 안 된다.
      this.ensureAutoplayNext().catch((error) => log.warn(`자동재생 미리 뽑기 실패: ${error?.message || error}`));

      return { success: true, track: this.currentTrack };
    } catch (error) {
      const errorMsg = ErrorHandler.handle(error, "MusicPlayer.play");
      await this.handleError(error, errorMsg);
      return { success: false, message: errorMsg };
    } finally {
      this.isPlayStarting = false;
    }
  }

  // 트랙 시작(0 부근)에서 시작하는 인트로 스킵 구간의 끝(ms). 없으면 0.
  // 이 값을 신규 재생의 초기 오프셋으로 써서 인트로를 무갭으로 건너뛴다.
  _introOffsetMs(track) {
    const segs = track?.sponsor?.skipSegments;
    if (!segs || !segs.length) return 0;
    const INTRO_START_TOL_SEC = 1; // 0~1초 사이에서 시작하면 인트로로 간주
    const intro = segs.find((s) => s.start <= INTRO_START_TOL_SEC);
    return intro && intro.end > 0 ? Math.round(intro.end * 1000) : 0;
  }

  // 조기 종료·SponsorBlock 곡 끝 판정에 쓰는 실제 오디오 길이. 곡 메타데이터(스포티파이 등)는 오디오와 수 초씩 다르다
  _audioDurationSec(streamInfo, downloadedFile) {
    if (downloadedFile && this.currentTrack?.audioSourceKey) {
      const cached = CacheManager.lookupByAudioKey(this.currentTrack.audioSourceKey)?.duration_sec;
      if (cached > 0) return cached;
    }
    return streamInfo?.duration > 0 ? streamInfo.duration : null;
  }

  /**
   * yt-dlp가 알려주는 전송 방식이 HLS인가. `m3u8`(우리가 받아 합치는 방식)과
   * `m3u8_native`(ffmpeg에게 맡기는 방식) 둘 다 재생목록이라 주소로 열어야 한다.
   */
  static isHlsStream(streamInfo) {
    const protocol = streamInfo && typeof streamInfo === "object" ? streamInfo.protocol : null;
    return typeof protocol === "string" && protocol.startsWith("m3u8");
  }

  /** 즉시 재생과 나란히 캐시를 받아 둔다. 기다리지 않으며, 실패해도 재생은 스트림으로 계속된다. */
  _startBackgroundDownload() {
    // currentTrack은 다운로드가 끝나기 전에 바뀔 수 있다. 지금 곡을 붙잡아 둔다
    const trackToDownload = this.currentTrack;
    this.downloader
      .downloadTrack(trackToDownload)
      .then((file) => {
        if (this.currentTrack && this.currentTrack.url === trackToDownload.url) {
          this.currentDownloadedFile = file;
        }
      })
      .catch((err) => {
        if (err && err.message) {
          log.warn(`백그라운드 캐시 다운로드 실패: ${err.message}. 재생은 스트림으로 계속됩니다.`);
        }
      });
  }

  /**
   * 재생용 ffmpeg 인자 구성. 출력 대상(`pipe:1`)까지 포함한 완전한 인자를 돌려준다.
   *
   * 입력은 셋 중 하나다.
   *  - `file`: 캐시 파일. `-ss`는 `-i` 앞(seek 가능해 빠름)
   *  - `url`: HLS 전용. 재생목록은 "받아 둔 바이트"가 아니라 "받아 올 주소"를 줘야 열린다
   *  - 둘 다 없으면 `pipe:0`: 그 밖의 모든 스트리밍. `-ss`는 `-i` 뒤여야 한다
   *    (pipe에서 입력측 `-ss`는 출력을 잘라먹는다)
   *
   * URL을 주는 것은 HLS에 한한다. 나머지를 URL로 열면 yt-dlp가 준 httpHeaders가 빠지고,
   * 스트리밍 실패 폴백을 건너뛰며, 재생이 ffmpeg 빌드의 네트워크 스택에 의존하게 된다.
   *
   * @param {{file?: string|null, url?: string|null, seekMs?: number}} opts
   */
  static buildFfmpegArgs({ file = null, url = null, seekMs = 0 } = {}) {
    const seek = seekMs > 0 ? ["-ss", (Number(seekMs) / 1000).toFixed(3)] : [];
    const output = ["-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"];

    if (url) {
      // 잔끊김은 ffmpeg 안에서 흡수시키고 우리 재시도는 진짜 실패에만 돌게 나눈다.
      // `-reconnect_at_eof`는 켜지 않는다. 라이브에서 EOF는 "방송이 끝났다"인데, 켜면
      // 오류로 보고 무한히 다시 붙는다.
      const reconnect = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1"];
      // 오래된 빌드에는 없는 옵션이다. ffmpeg는 모르는 옵션을 치명적 오류로 보므로 확인하고 붙인다.
      const retry = ffmpegCapabilities().segMaxRetry ? ["-seg_max_retry", String(SEG_MAX_RETRY)] : [];
      return [...reconnect, ...retry, "-analyzeduration", "0", "-loglevel", "error", ...seek, "-i", url, ...output];
    }

    return file ? [...seek, "-i", file, "-analyzeduration", "0", "-loglevel", "error", ...output] : ["-analyzeduration", "0", "-loglevel", "error", "-i", "pipe:0", ...seek, ...output];
  }

  /**
   * 스트림이 죽었을 때 캐시 파일로 소리 없이 갈아탄다. 예약했으면 true.
   * 캐시가 아직 없으면 하지 않는다 — 스트림이 이어받거나, Idle → play(위치)가 받는다.
   */
  _planCacheSwitch(splicer, track) {
    const giveUp = (why) => {
      wlog.debug(`무지연 전환 포기: ${this._trackLabel()} — ${why}`);
      return false;
    };

    if (!splicer || splicer.destroyed || splicer.switchPending) return giveUp("전환할 수 있는 상태가 아님");
    // 늦게 도착한 오류가 다음 곡의 재생을 건드리지 않도록
    if (!track || this.currentTrack !== track) return giveUp("이미 다른 곡으로 넘어감");

    const file = this.currentDownloadedFile;
    try {
      if (!file || !fsSync.existsSync(file) || fsSync.statSync(file).size === 0) return giveUp("쓸 수 있는 캐시 파일이 없음");
    } catch {
      return giveUp("캐시 파일 조회 실패"); // 기존 경로로 넘긴다
    }

    // 전환 지점은 스플라이서 출력 기준이다. 리소스는 그보다 뒤처져 있으므로
    // resource.playbackDuration을 쓰면 자기 정합적이지 않다.
    const atMs = splicer.emittedMs + SWITCH_LEAD_MS;
    const seekMs = this.currentTrackStartOffsetMs + atMs; // 캐시 파일 안에서의 절대 위치

    let decoder;
    try {
      decoder = spawnFfmpeg(MusicPlayer.buildFfmpegArgs({ file, seekMs }), "switch");
    } catch (error) {
      log.warn(`캐시 재생용 ffmpeg를 띄우지 못했습니다: ${error.message}`);
      return false;
    }

    if (!splicer.planSwitch(decoder.stdout, atMs)) {
      decoder.kill("SIGKILL");
      return false;
    }
    splicer.once("switched", (ms) => {
      log.info({ tags: ["fallback", "recovered"] }, `오디오 캐시로 무지연 전환: ${this._trackLabel()}`);
      // 지점·조정 횟수는 스플라이서 내부 수치라 조사할 때만 본다.
      wlog.debug(`무지연 전환 상세: ${(ms / 1000).toFixed(1)}초 지점${splicer.slips ? ` | 지점 조정 ${splicer.slips}회` : ""}`);
    });
    return true;
  }

  scheduleTrackWatchdog(streamInfo = null) {
    if (this.trackTimer) {
      clearTimeout(this.trackTimer);
    }

    const streamDuration = streamInfo && Number(streamInfo.duration) > 0 ? Number(streamInfo.duration) : null;
    const trackDuration = this.currentTrack && Number(this.currentTrack.duration) > 0 ? Number(this.currentTrack.duration) : null;
    const durationSeconds = streamDuration || trackDuration;

    // 라이브는 길이가 없다. 폴백 워치독(5분 뒤 강제 종료)이 방송을 잘라 버린다.
    if (this.currentTrack?.isLive) {
      this.expectedTrackEndTs = null;
      this.trackTimer = null;
      wlog.debug(`종료 감시 없음: ${this._trackLabel()} | 라이브는 길이로 가를 수 없다`);
      return;
    }

    if (durationSeconds && durationSeconds > 0) {
      // 시작 오프셋을 고려해 남은 시간 계산 (초)
      const startOffsetSeconds = Math.floor((this.currentTrackStartOffsetMs || 0) / 1000);
      const remainingSeconds = Math.max(1, durationSeconds - startOffsetSeconds);

      this.expectedTrackEndTs = Date.now() + remainingSeconds * 1000;
      // 4초 버퍼를 추가하되 최소 5초 타임아웃 보장
      const timeoutMs = Math.max(remainingSeconds * 1000 + 4000, 5000);

      wlog.debug(`종료 감시 예약: ${this._trackLabel()} | 길이 ${durationSeconds}초(${this._durationSource()}) | 오프셋 ${startOffsetSeconds}초 | ${Math.round(timeoutMs / 1000)}초 뒤 확인`);
      this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), timeoutMs);
    } else {
      // 폴백 워치독: 길이를 알 수 없는 스트림은 5분마다 확인
      this.expectedTrackEndTs = null;
      wlog.warn(`종료 감시 예약: ${this._trackLabel()} | 길이를 몰라 5분 뒤 강제 종료합니다`);
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

  // Buffering이 안 끝나면 voice는 아무 이벤트도 내지 않는다
  _startBufferingWatch() {
    this._clearBufferingWatch();
    this._bufferingSince = Date.now();
    this._bufferingTimer = setInterval(() => this._checkBufferingStall(), 1000);
    this._bufferingTimer.unref?.();
  }

  // 입력이 조금씩이라도 들어오면 정체가 아니다 — Range를 못 쓰는 입력의 위치 재개는 앞부분을 읽어 넘기느라 오래 걸린다
  _checkBufferingStall(now = Date.now()) {
    if (this.audioPlayer?.state?.status !== AudioPlayerStatus.Buffering) return this._clearBufferingWatch();
    const quietSince = Math.max(this._bufferingSince ?? now, this._inputProgressAt ?? 0);
    if (now - quietSince < BUFFERING_STALL_MS) return;
    this._clearBufferingWatch();
    wlog.warn(`재생이 시작되지 않아 다시 시도합니다: ${this._trackLabel()} | 버퍼링 ${sec(now - this._bufferingSince)}초, 입력 없음 ${sec(now - quietSince)}초`);
    if (!this.pendingEndReason) this.pendingEndReason = "buffering-stall";
    // force 없이는 무음 패딩만 예약되고 Buffering에서 벗어나지 않는다(패딩은 Playing에서만 소비된다)
    this.audioPlayer.stop(true);
  }

  _clearBufferingWatch() {
    if (this._bufferingTimer) {
      clearInterval(this._bufferingTimer);
      this._bufferingTimer = null;
    }
  }

  // 워치독 로그용 — 트랙 식별과 길이 출처
  _trackLabel(track = this.currentTrack) {
    return `"${track?.title ?? "?"}" (${track?.platform ?? "?"})`;
  }

  _durationSource() {
    const t = this.currentTrack;
    if (!(Number(t?.duration) > 0)) return "없음";
    return t?.durationSource || "제공값";
  }

  // 2초 폴링이 같은 줄을 도배하지 않게, 직전과 다를 때만 남긴다
  _logWatchdogOnce(line) {
    if (this._lastWatchdogLine === line) return;
    this._lastWatchdogLine = line;
    wlog.debug(line);
  }

  ensureTrackCompletion() {
    if (!this.currentTrack) {
      this.trackTimer = null;
      return;
    }

    // 라이브는 길이가 없어 "다 틀었나"를 길이로 가를 수 없다. 이 감시를 걸지 않는다.
    // 끊김은 버퍼링 정체 감지와 ffmpeg 종료 코드가 잡는다.
    if (this.currentTrack.isLive) {
      this.trackTimer = null;
      return;
    }

    const status = this.audioPlayer.state?.status;
    // playbackDuration은 이 리소스가 낸 양이라 시작 오프셋을 더해야 곡 안의 위치가 된다
    const playedMs = (this.currentTrackStartOffsetMs || 0) + (this.resource?.playbackDuration || 0);
    const playedSec = (playedMs / 1000).toFixed(1);

    if (status === AudioPlayerStatus.Playing) {
      const durationMs = (Number(this.currentTrack.duration) || 0) * 1000;

      if (durationMs > 0 && playedMs + 1500 < durationMs) {
        const remainingMs = Math.max(durationMs - playedMs, 2000);
        wlog.debug(`종료 감시: ${this._trackLabel()} | 재생 ${playedSec}초 / 예상 ${durationMs / 1000}초 — 아직 남음, ${Math.round(remainingMs / 1000)}초 뒤 재확인`);
        this.trackTimer = setTimeout(() => this.ensureTrackCompletion(), remainingMs);
        return;
      }

      // 여기서 stop()을 부르면 Idle이 발생해 다음 곡으로 넘어간다. 워치독이 실제로 "일을 한" 유일한 지점.
      wlog.warn(`종료 감시가 트랙을 정지시킴: ${this._trackLabel()} | 재생 ${playedSec}초 / 예상 ${durationMs > 0 ? durationMs / 1000 + "초" : "모름"} | 길이출처=${this._durationSource()}`);

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
      wlog.debug(`종료 감시: ${this._trackLabel()} | 상태=${status} — 종료 처리에 맡기고 감시를 끝냅니다`);
      this.trackTimer = null;
      return;
    }

    // 알 수 없는 상태, 계속 감시 (일시정지 등) — 2초마다 도므로 상태가 바뀔 때만 남긴다
    this._logWatchdogOnce(`👁 워치독 확인: ${this._trackLabel()} | 상태=${status} | 재생 ${playedSec}s → 2s 간격 감시 중`);
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
      if (!this.pauseReasons.has(reason)) {
        log.info(`일시정지: 원인=${reason} | ${this._trackLabel()}`);
      }
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

    // 버퍼링 중이면 의도만 받아 둔다 — 재생으로 넘어오는 순간 Playing 리스너가 멈춘다
    if (status === AudioPlayerStatus.Buffering && this.pauseReasons.size > 0) {
      this.paused = true;
      this.scheduleStatePersist("pause", 0);
      return true;
    }

    return false;
  }

  resumeFor(reason = null) {
    if (reason) {
      if (this.pauseReasons.has(reason)) {
        log.info(`일시정지 해제: 원인=${reason} | ${this._trackLabel()}`);
      }
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

    if (status === AudioPlayerStatus.Playing || status === AudioPlayerStatus.Buffering) {
      this.paused = false;
      this.scheduleStatePersist("resume", 0);
      return true;
    }

    return false;
  }

  startInactivityTimer() {
    if (this.inactivityTimer) return;

    log.info(`서버 ${this.guild?.name ?? this.guild?.id}의 채널 ${this.voiceChannel?.name ?? this.voiceChannel?.id}에 사람이 없습니다. ${Math.round(this.inactivityTimeoutMs / 1000)}초 뒤 정리합니다`);
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
        trackState.reset(this);

        try {
          const embedManager = this.guild?.client?.musicEmbedManager;
          await embedManager?.handlePlaybackEnd(this, { reason: "disconnected" });

          await this.persistState("inactivity-timeout");
        } catch (error) {
          log.error("비활성 정리 후 재생 UI 갱신 실패:", error);
        } finally {
          // 교체된 뒤 남은 타이머가 현행 플레이어의 연결을 끊지 않도록 (대기열 소진 타이머와 같은 사고)
          if (!this._isActivePlayer()) {
            log.info(`밀려난 플레이어의 비활성 타이머 — 자기 자원만 정리합니다 (${this.guild?.name ?? this.guild?.id})`);
            this.releaseResources();
            this.releaseAudioProtection();
          } else {
            try {
              this.cleanup(false, "비활성 타임아웃");
            } finally {
              this.guild?.client?.players?.delete(this.guild.id);
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
      // 여기가 "정리 예약이 취소된다"는 상태 변화가 실제로 일어나는 지점이다.
      // 예약을 건 타이머 콜백 안에도 같은 로그가 있었는데, 사람이 돌아오면 음성 상태 이벤트가
      // 이 함수를 먼저 불러 타이머를 지우므로 그 콜백은 아예 실행되지 않았다 — 거의 안 찍혔다.
      if (shouldResume) log.info(`서버 ${this.guild?.name ?? this.guild?.id}의 채널 ${this.voiceChannel?.name ?? this.voiceChannel?.id}에 사람이 복귀하여 정리를 취소합니다`);
    }

    if (shouldResume) {
      this.resumeFor("alone");
    } else {
      this.pauseReasons.delete("alone");
    }
  }

  /**
   * 재생 상태나 저장된 세션 데이터를 건드리지 않고 모든 반복 타이머를 해제.
   * 플레이어가 폐기될 때마다 (stop/leave/접속 실패) 호출해야 함.
   * 그렇지 않으면 30초 상태 검사 interval이 플레이어 객체를 영원히 붙잡습니다.
   */
  /**
   * 이 플레이어가 아직 이 서버의 현행 플레이어인가.
   *
   * 교체되고도 남아 있던 타이머가 뒤늦게 깨어나 다른 플레이어의 등록과 음성 연결을
   * 건드리는 사고가 있었다(대기열 소진 타이머가 재생 중인 새 플레이어를 레지스트리에서
   * 지움). 지연 실행되는 정리 경로는 반드시 이걸로 자기 차례인지 확인한다.
   */
  _isActivePlayer() {
    return this.guild?.client?.players?.get(this.guild.id) === this;
  }

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

    if (this.queueEmptyTimer) {
      clearTimeout(this.queueEmptyTimer);
      this.queueEmptyTimer = null;
    }

    this._clearBufferingWatch();
  }

  // 재생 중 트랙의 캐시 퇴거 보호 해제 — currentTrack이 이미 null이어도 기억된 키로 해제
  releaseAudioProtection() {
    const key = this._protectedAudioKey || this.currentTrack?.audioSourceKey;
    if (key) CacheManager.unprotect(key);
    this._protectedAudioKey = null;
  }

  stop() {
    clog.info(`정지: ${this._trackLabel()} | 대기열 ${this.queue?.length ?? 0}곡 비움`);
    this.updateVoiceStatus("").catch(() => {});

    this.sponsorSkipper?.stop();
    this.pauseReasons.clear();
    this.paused = false;

    this.releaseResources();
    this.persistence?.removeSession();

    this.releaseAudioProtection();

    this.currentDownloadedFile = null;

    // 종료 로그가 뒤늦게(Idle 이후) 도는데 여기서 currentTrack을 비우므로 라벨만 남겨둔다
    this._endingLabel = `"${this.currentTrack?.title ?? "?"}" (${this.currentTrack?.platform ?? "?"})`;
    trackState.reset(this);
    this.pendingEndReason = "stop";
    this.stopRequested = true;
    this.currentTrackStartOffsetMs = 0;
    this.lastPlaybackPosition = 0;
    this.audioPlayer.stop(true);
    this.disconnect();
  }

  async leaveAndSave() {
    this.updateVoiceStatus("").catch(() => {});

    // 연결 해제 전에 전체 상태(대기열, 위치, 설정) 저장
    await this.persistState("leave", true);

    // stop()과 같은 연결 해제 절차이지만 세션은 지우지 않는다
    this.pauseReasons.clear();
    this.paused = false;
    this.releaseResources();

    this.releaseAudioProtection();

    this.currentDownloadedFile = null;

    trackState.reset(this);
    this.pendingEndReason = "stop";
    this.stopRequested = true;
    this.currentTrackStartOffsetMs = 0;
    this.lastPlaybackPosition = 0;
    this.audioPlayer.stop(true);
    this.disconnect();
  }

  /**
   * 재생 위치 이동. `/seek`·`/replay`·`/highlight`·대시보드가 전부 여기를 지난다.
   *
   * 각 진입점이 `play(null, ms)`를 직접 부르면 로그에는 새 곡이 시작된 것과 똑같이 보인다.
   * 사람이 위치를 옮긴 것과 봇이 다음 곡으로 넘어간 것을 가릴 수 없어지는데, `control`
   * 카테고리를 따로 가른 이유가 정확히 그것이다. 진입점마다 로그를 다는 대신 통로를 하나로 둔다.
   *
   * @param {number} seekMs  이동할 위치(ms)
   * @param {string} reason  누가 시켰나 — "seek" | "replay" | "highlight" | "dashboard"
   */
  seek(seekMs, reason = "seek") {
    // 라이브에는 실시간밖에 없다. 되감을 자리도, 앞서 갈 자리도 없다.
    if (this.currentTrack?.isLive) {
      clog.info(`위치 이동 거부: ${this._trackLabel()} | 라이브 | 원인=${reason}`);
      return { success: false, message: S.ERR_LIVE_NO_SEEK };
    }
    const from = Math.round((this.lastPlaybackPosition || 0) / 1000);
    clog.info(`위치 이동: ${this._trackLabel()} | ${from}초 → ${Math.round(seekMs / 1000)}초 | 원인=${reason}`);
    return this.play(null, seekMs);
  }

  // reason: "skip"(기본) 또는 "jump"(대기열 점프 — 한곡 반복 중에도 재시작이 아니라 선택 곡으로 이동)
  skip(reason = "skip") {
    if (this.currentTrack) {
      clog.info(`스킵: ${this._trackLabel()} | 원인=${reason} | 대기열 ${this.queue?.length ?? 0}곡`);
      // 트랙 타이머 정리
      if (this.trackTimer) {
        clearTimeout(this.trackTimer);
        this.trackTimer = null;
      }

      if (this.queueEmptyTimer) {
        clearTimeout(this.queueEmptyTimer);
        this.queueEmptyTimer = null;
      }

      this.pendingEndReason = reason;
      this.skipRequested = true;
      this.audioPlayer.stop(true);
      this.scheduleStatePersist("skip", 0);
      return true;
    }
    return false;
  }

  previous() {
    clog.info(`이전곡: ${this._trackLabel()} | 이전 기록 ${this.previousTracks?.length ?? 0}곡 | 반복=${this.loop || "off"}`);
    // 한곡 반복 중 이전곡 = 현재 곡 재시작 — 대기열·기록 불변.
    if (this.loop === "track") {
      if (!this.currentTrack) return false;
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

    if (this.previousTracks.length > 0) {
      // 현재 트랙은 currentTrack으로 남겨 handleTrackEnd가 기록하게 한다. 여기서 이전 트랙을
      // 미리 할당하면 "예기치 않게 종료됨" 재시도 로직이 그 곡을 중간부터 재개한다.
      trackState.rewind(this);

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
    const before = this.volume;
    this.volume = Math.max(0, Math.min(100, volume));
    if (before !== this.volume) clog.info(`볼륨: ${before}% → ${this.volume}%`);
    if (this.resource && this.resource.volume) {
      this.resource.volume.setVolume(this.volume / 100);
    }
    this.scheduleStatePersist("volume", 200);
    return this.volume;
  }

  shuffleQueue() {
    if (this.queue.length > 1) {
      clog.info(`대기열 섞음: ${this.queue.length}곡`);
      trackState.shuffle(this);
      this.scheduleStatePersist("shuffle-queue", 200);
      return true;
    }
    return false;
  }

  /** 재생 중이거나 대기열에 라이브가 있는가. 반복은 끝이 있어야 성립한다. */
  hasLiveTrack() {
    if (this.currentTrack?.isLive) return true;
    return Boolean(this.queue?.some((track) => track?.isLive));
  }

  /** 라이브가 대기열에 들어왔을 때 걸려 있던 반복을 푼다. 풀었으면 true. */
  releaseLoopForLive() {
    if (!this.loop) return false;
    clog.info(`반복 해제: 라이브가 들어와 반복(${this.loop})을 풉니다`);
    this.setLoop(false);
    return true;
  }

  setLoop(mode) {
    // 모드: false, 'track', 'queue'
    // 끝이 없는 것은 반복할 수 없다. 켜려는 요청만 막고 끄는 것은 언제나 통한다.
    if (mode && this.hasLiveTrack()) {
      clog.info(`반복 거부: 라이브가 있어 반복(${mode})을 켜지 않습니다`);
      return this.loop;
    }
    if (this.loop !== mode) clog.info(`반복: ${this.loop || "off"} → ${mode || "off"}`);
    this.loop = mode;
    this.scheduleStatePersist("loop", 200);
    return this.loop;
  }

  /**
   * 자동재생 장르 설정(false면 끔). 진입점들이 `player.autoplay`에 직접 대입하고 있었는데,
   * 그러면 대기열이 저절로 늘어난 이유를 로그에서 찾을 수 없다 — 곡이 붙는 것만 보이고
   * 누가 켰는지가 없다. 반복·볼륨과 같은 조작이므로 같은 자리에 둔다.
   */
  setAutoplay(genre) {
    const next = genre || false;
    const changed = this.autoplay !== next;
    if (changed) clog.info(`자동재생: ${this.autoplay || "off"} → ${next || "off"}`);
    this.autoplay = next;

    // 미리 뽑아 둔 곡은 껐으면 남을 이유가 없고, 장르를 바꿨으면 이전 장르의 곡이다.
    // 사용자가 넣은 곡은 건드리지 않는다.
    if (changed) {
      const dropped = trackState.dropAutoplay(this);
      if (dropped > 0) clog.info(`미리 뽑아 둔 자동재생 곡 ${dropped}곡을 대기열에서 뺐습니다`);
      if (next) this.ensureAutoplayNext().catch(() => {});
    }

    this.scheduleStatePersist("autoplay", 200);
    return this.autoplay;
  }

  clearQueue() {
    const cleared = this.queue.length;
    if (cleared) clog.info(`대기열 비움: ${cleared}곡`);
    trackState.clearQueue(this);
    this.scheduleStatePersist("clear-queue", 0);
    return cleared;
  }

  removeFromQueue(index) {
    const removed = trackState.removeAt(this, index);
    if (removed) {
      clog.info(`대기열 제거: [${index}] "${removed?.title ?? "?"}" | 남은 ${this.queue.length}곡`);
      this.scheduleStatePersist("queue-remove", 200);
      return removed;
    }
    return null;
  }

  moveInQueue(from, to) {
    const track = trackState.move(this, from, to);
    if (track) {
      clog.info(`대기열 이동: "${track?.title ?? "?"}" ${from}번 → ${to}번`);
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
    this.sponsorSkipper?.stop(); // 다음 트랙 play()가 onPlayStart로 다시 가동

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
      // "sponsorblock"(아웃트로 종료)은 스킵 버튼과 동일하게 트랙 완료로 취급 — 조기 드롭 복구 대상 아님.
      const manualSkip = reason === "skip" || reason === "stop" || reason === "previous" || reason === "jump" || reason === "sponsorblock";
      const endedUnexpectedly = Boolean(finishedTrack) && !manualSkip && durationMs > 0 && totalPlaybackMs + 1500 < durationMs;
      // 라이브는 길이가 없어 "일찍 끝났다"로 가를 수 없다. ffmpeg의 종료 코드로 가른다.
      // 0이면 방송이 끝난 것(EOF)이라 다음 곡으로 넘기고, 그 밖은 사고라 다시 연다.
      const liveDropped = this._playingLive && !manualSkip && this._liveExitCode !== 0;

      const endedLabel = finishedTrack ? this._trackLabel(finishedTrack) : this._endingLabel || this._trackLabel(null);
      this._endingLabel = null;
      log.info(`트랙 종료: ${endedLabel} | 원인=${reason}`);
      // 재생/길이 대조는 종료 감시 판정용 수치라 조사할 때만 본다.
      wlog.debug(`트랙 종료 상세: 재생 ${(totalPlaybackMs / 1000).toFixed(1)}초 / 길이 ${durationMs > 0 ? durationMs / 1000 + "초" : "모름"}`);

      if (endedUnexpectedly || liveDropped) {
        // 곡이 바뀌는 경로가 여기만이 아니라서, 포기할 때 비우는 대신 곡으로 가른다
        if (this._retryTrack !== finishedTrack) {
          this._retryTrack = finishedTrack;
          this.currentTrackRetries = 0;
        }
        this.currentTrackRetries += 1;
        const at = `${sec(totalPlaybackMs)}초`;
        if (liveDropped) {
          if (this.currentTrackRetries <= MAX_LIVE_REOPENS) {
            log.warn({ tags: ["retry"] }, `라이브 연결이 끊겨 다시 엽니다: ${endedLabel} (${this.currentTrackRetries}/${MAX_LIVE_REOPENS})`);
            // 주소에는 수명이 있고, 만료된 주소로는 몇 번을 다시 붙어도 실패한다.
            // 위치 0으로 트는 것이 곧 "yt-dlp로 주소를 새로 받는다"이고, 라이브는 애초에 엣지로만 붙는다.
            await new Promise((done) => setTimeout(done, LIVE_REOPEN_DELAY_MS * this.currentTrackRetries));
            await this.play(null, 0);
            return;
          }
          log.error(`라이브를 다시 열지 못해 다음 곡으로 넘깁니다: ${endedLabel} | 재시도 ${MAX_LIVE_REOPENS}회 소진`);
        } else if (this.currentTrackRetries <= MAX_TRACK_RETRIES) {
          log.warn({ tags: ["retry"] }, `재생이 끊겨 ${at} 지점부터 다시 재생합니다: ${endedLabel} (${this.currentTrackRetries}/${MAX_TRACK_RETRIES})`);
          await this.play(null, totalPlaybackMs);
          return;
        } else {
          log.error(`재생을 복구하지 못해 다음 곡으로 넘깁니다: ${endedLabel} | ${at} 지점, 재시도 ${MAX_TRACK_RETRIES}회 소진`);
        }
      } else {
        this.currentTrackRetries = 0;
      }

      if (!finishedTrack) {
        this.resource = null;
        return;
      }

      // 참조 해제 (파일은 디스크에 유지 — 제거는 CacheManager가 처리)
      this.currentDownloadedFile = null;

      if (this.loop === "track" && reason !== "stop" && reason !== "jump") {
        // 한곡 반복: 자연 종료·스킵·이전곡 모두 현재 곡을 처음부터 다시 재생
        // 대기열·이전 곡 기록은 불변 — 다음 곡으로 넘어가려면 반복 해제 또는 대기열 점프(jump).
        await this.play(null, 0);
        return;
      }
      if (reason !== "previous") {
        trackState.retire(this, finishedTrack, { requeue: this.loop === "queue" });
      }

      this.resource = null;
      this.expectedTrackEndTs = null;
      this.startTime = null;
      this.pausedTime = 0;
      this.lastPlaybackPosition = 0;
      this.currentTrackStartOffsetMs = 0;
      this.currentTrackCache = null;

      if (this.queue.length > 0) {
        trackState.shiftNext(this);

        // 다음 트랙을 처음부터 재생
        await this.play(null, 0);

        if (this.guild?.client?.musicEmbedManager) {
          await this.guild.client.musicEmbedManager.updateNowPlayingEmbed(this);
        }

        return;
      }

      if (this.autoplay) {
        const { genres } = require("./configDataLoader").genres();
        if (!genres[this.autoplay]) {
          // 알 수 없는 장르(장르 목록 변경 전에 저장된 세션 등) — 끄고 알린 뒤 아래의 일반 대기열 종료 흐름으로
          log.warn(`자동재생을 종료합니다. 알 수 없는 장르: ${this.autoplay}`);
          if (this.textChannel) {
            this.textChannel?.send(`❌ 자동재생 장르 \`${this.autoplay}\`(을)를 찾을 수 없어 자동재생을 껐습니다. \`/autoplay\`로 다시 설정해 주세요.`).catch(() => {});
          }
          this.autoplay = false;
        } else {
          this.currentTrackRetries = 0;
          // 틀었을 때만 여기서 끝낸다. 못 골랐으면 아래 대기열 소진 흐름으로 떨어진다 —
          // 그냥 return하면 현재곡이 끝난 곡을 가리킨 채 남아 곡 추가·스킵이 전부 먹통이 된다.
          // 이때 자동재생은 켜 둔 채로 둔다. 후보를 한 번 못 찾은 것이 장르를 끌 이유는 아니다.
          if (await this.handleAutoplay()) return;
        }
      }

      trackState.setCurrent(this, null);
      this.currentTrackCache = null;
      this.currentTrackStartOffsetMs = 0;

      this.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});

      await this.guild?.client?.musicEmbedManager?.handlePlaybackEnd(this, { reason: "queue-end" });

      this.clearInactivityTimer(false);
      this.persistence?.removeSession();

      this.scheduleIdleLeave();
    } finally {
      this.isTransitioning = false;
      this.skipRequested = false;
      this.stopRequested = false;
      this.pendingEndReason = null;
    }
  }

  /**
   * 틀 것 없이 음성에 남아 있으면 잠시 뒤 나간다 — 대기열이 끝났을 때와 /join만 했을 때.
   * 다시 예약할 때 이전 것을 반드시 지운다 — 쌓아두면 이 플레이어가 교체된 뒤에도 하나씩 깨어나 남의 플레이어를 정리한다.
   * 그 사이 곡을 틀었으면 깨어나도 아무것도 하지 않는다.
   */
  scheduleIdleLeave(reason = "대기열 소진") {
    if (this.queueEmptyTimer) clearTimeout(this.queueEmptyTimer);
    this.queueEmptyTimer = setTimeout(() => {
      this.queueEmptyTimer = null;
      if (this.queue.length !== 0 || this.currentTrack) return;
      if (!this._isActivePlayer()) {
        log.info(`밀려난 플레이어의 대기열 소진 타이머 — 자기 자원만 정리합니다 (${this.guild?.name ?? this.guild?.id})`);
        this.releaseResources();
        this.releaseAudioProtection();
        return;
      }
      this.cleanup(false, reason);
      this.guild.client.players.delete(this.guild.id);
      // 끝난 패널의 "쉬러 갈게요"를 음성 밖 문구로
      this.guild.client.musicEmbedManager?.handlePlaybackEnd(this, { reason: "disconnected" }).catch(() => {});
    }, config.bot.leaveDelayQueueEmptyMs);
  }

  /**
   * 자동재생 후보 한 곡을 고른다. 못 고르면 null.
   *
   * 고르기만 한다 — 대기열도 재생도 건드리지 않는다. 부르는 쪽이 지금 틀지(handleAutoplay)
   * 미리 대기열에 둘지(ensureAutoplayNext) 정한다.
   */
  async pickAutoplayTrack() {
    if (!this.autoplay || typeof this.autoplay !== "string") return null;

    try {
      // 장르 정의와 기준값은 config/genres.yaml 한 곳에서 관리. 장르가 기준값을 덮어쓴다.
      const cfg = this._autoplayConfig();
      if (!cfg) return null;

      // 최근에 튼 곡과 대기열에 이미 있는 곡을 함께 넘긴다. 미리 뽑아 둔 자동재생 곡이
      // 대기열에 있으므로, 그걸 빼지 않으면 같은 곡을 두 번 고를 수 있다.
      const recent = [this.currentTrack, ...this.previousTracks.slice(-20), ...this.queue].filter(Boolean);

      const picked = await autoplayRoute.pickTrack(cfg, recent);
      if (!picked) {
        log.warn(`자동재생: 어느 소스에서도 곡을 찾지 못했습니다 (장르 ${this.autoplay})`);
        return null;
      }

      picked.requestedBy = this.guild.members.me.user;
      picked.addedAt = Date.now();
      picked.autoplay = true; // 대기열 표시·정리에서 사용자 곡과 가른다

      // 어디서 어떻게 왔는지 한 줄. 소스가 여럿이 되면서 "이 곡이 왜 나왔지"를 로그로 되짚을 수
      // 있어야 한다 — 재생·종료 쪽에는 출처가 찍히는데 정작 고르는 자리에 없었다.
      const how = picked.platform === "direct" ? "음원 직접" : picked.youtubeUrl ? `유튜브 ${picked.youtubeUrl}` : "유튜브";
      clog.info(`자동재생 뽑기: "${picked.title}" — ${picked.artist || "?"} (장르 ${this.autoplay}, 소스 ${picked.pickedFrom || "?"} → ${how})`);
      return picked;
    } catch (error) {
      log.error("자동재생 오류:", error.message);
      return null;
    }
  }

  /**
   * 틀 것이 하나도 없을 때 — 아무거나 틀지 않고 알린 뒤 끈다.
   *
   * 조용히 멈추면 무엇이 잘못됐는지 알 길이 없다. pickTrack은 이미 모든 소스를 훑고 오므로
   * 여기까지 왔다는 것은 한 번 삐끗한 것이 아니라 정말로 낼 것이 없다는 뜻이다.
   */
  _giveUpAutoplay() {
    if (!this.autoplay) return;
    const genre = this.autoplay;
    log.warn(`자동재생을 종료합니다. 곡을 찾지 못했습니다 (장르 ${genre})`);
    this.textChannel?.send(`⏹️ \`${genre}\` 장르에서 틀 만한 곡을 찾지 못해 자동재생을 껐습니다.`).catch(() => {});
    this.setAutoplay(false);
  }

  /** 지금 골라서 바로 튼다 — 곡이 끝났을 때와, 아무것도 안 틀고 있을 때 켠 경우. 틀었으면 true. */
  async handleAutoplay() {
    const picked = await this.pickAutoplayTrack();
    if (!picked) {
      // 미리 뽑기(ensureAutoplayNext)에서는 끄지 않는다 — 거기서는 못 골라도 여기서 다시 해 본다.
      this._giveUpAutoplay();
      return false;
    }

    trackState.enqueue(this, [picked]);
    trackState.shiftNext(this);
    await this.play(null, 0);

    const embeds = this.guild?.client?.musicEmbedManager;
    if (embeds) {
      // 패널이 없을 수 있다 — 아무것도 안 틀던 서버에서 자동재생으로 처음 트는 길.
      // updateNowPlayingEmbed는 있는 패널을 고칠 뿐이라, 그대로 두면 소리만 나고 화면이 없다.
      if (this.nowPlayingMessage) await embeds.updateNowPlayingEmbed(this);
      else await embeds.createNewMusicEmbed(this, this.currentTrack, this.guild.members.me.user);
    }
    return true;
  }

  /**
   * 곡이 시작될 때 다음 자동재생 곡을 미리 대기열에 둔다.
   *
   * 그래야 QueueWarmer가 평소처럼 받아 두고 전환이 즉시가 된다. 지금까지는 곡이 끝난 뒤에야
   * 검색을 시작해 그만큼 소리가 비었다(B-50) — 자동재생 곡이 대기열에 머무는 시간이 0이었다.
   *
   * 부르는 쪽은 기다리지 않는다. 검색에 몇 초가 걸리는데 그걸 기다리면 재생 시작이 늦어진다.
   */
  async ensureAutoplayNext() {
    if (this._autoplayPicking) return false; // 고르는 중 — 겹쳐 부르면 두 곡이 들어간다
    if (!this._canPrefetchAutoplay()) return false;

    this._autoplayPicking = true;
    try {
      // prefetchCount만큼 채운다. 한 번에 한 곡만 넣으면 값을 키워도 늘 한 곡 앞만 보게 된다
      // — 부르는 쪽은 곡이 시작할 때 한 번 부를 뿐이라 다시 불러 주는 사람이 없기 때문이다.
      //
      // 다만 쉬지 않고 연달아 뽑지는 않는다. 뽑기 한 번에 유튜브 검색이 여러 번 나가므로
      // (소스 재시도 × 검색어) 다섯 곡을 붙여 뽑으면 수십 번이 몇 초 안에 몰린다.
      // 급한 것은 첫 곡뿐이니 나머지는 예열과 같은 간격(preload.gapMs)을 둔다.
      //
      // (한때 이 몰아치기가 내려받기 403의 원인이라고 적어 뒀는데 틀렸다. 그 뒤 예열 대상이
      //  한 곡뿐일 때도, 사용자가 넣은 유튜브 재생목록에서도 같은 403이 났다. 저쪽 사정이다 —
      //  yt-dlp #17395 참고. 간격 자체는 저쪽을 덜 두드리니 그대로 둔다.)
      let added = 0;
      while (this._canPrefetchAutoplay()) {
        if (added > 0) {
          await new Promise((done) => setTimeout(done, this._prefetchGapMs ?? config.preload.gapMs));
          if (!this._canPrefetchAutoplay()) break; // 쉬는 사이 사용자가 곡을 넣었을 수 있다
        }

        const picked = await this.pickAutoplayTrack();
        if (!picked) break;
        // 고르는 사이 대기열이 변했을 수 있다 — 사용자가 곡을 넣었으면 미리 뽑기는 취소한다.
        if (!this._canPrefetchAutoplay()) break;

        trackState.enqueue(this, [picked]);
        added++;
        clog.info(`자동재생 미리 뽑기: "${picked.title}" (장르 ${this.autoplay}, 소스 ${picked.pickedFrom || "?"})`);
      }

      if (added && this.guild?.client?.musicEmbedManager) {
        await this.guild.client.musicEmbedManager.updateNowPlayingEmbed(this).catch(() => {});
      }
      return added > 0;
    } finally {
      this._autoplayPicking = false;
    }
  }

  // 지금 장르의 자동재생 설정 — 기준값 위에 장르 설정을 얹는다. 모르는 장르면 null.
  _autoplayConfig() {
    const { defaults, genres } = require("./configDataLoader").genres();
    const genre = genres[this.autoplay];
    // 이름도 같이 넘긴다 — AI 보조가 "이 장르가 맞나"를 물을 때 쓴다(autoplayAssist)
    return genre ? { ...defaults, ...genre, genreName: this.autoplay } : null;
  }

  // 미리 뽑아 둘 수 있는 상태인가 — 고르기 전과 넣기 직전에 같은 것을 본다.
  _canPrefetchAutoplay() {
    if (!this.autoplay || typeof this.autoplay !== "string") return false;
    if (!this.currentTrack) return false; // 틀고 있는 게 없으면 미리 둘 이유가 없다
    if (this.loop === "track") return false; // 한곡 반복이면 다음 곡으로 넘어가지 않는다
    const want = Number(this._autoplayConfig()?.prefetchCount ?? 1);
    return this.queue.length < Math.max(1, want);
  }

  async handleError(error, userMessage = null) {
    // 내려간 영상을 고른 자동재생 곡 — 우리가 고른 것이니 사용자에게 알릴 일이 아니다.
    // 기억해 두고(다음에 또 고르지 않게) 조용히 다른 곡으로 넘어간다.
    const failed = this.currentTrack;
    if (failed?.autoplay && require("./YouTube").isVideoUnavailableError(error)) {
      autoplayRoute.markDead(failed);
      log.info(`자동재생 곡을 건너뜁니다(영상 없음): "${failed.title}"`);
      userMessage = null;
    }

    // 대기열이 비었어도 자동재생 중이면 멈추지 않는다 — 그대로 두면 봇이 얼어붙는다.
    if (this.queue.length === 0 && this.autoplay) {
      trackState.setCurrent(this, null);
      if (await this.handleAutoplay()) return;
    }

    // 오류 시 다음 트랙으로 스킵 시도
    if (this.queue.length > 0) {
      // 스킵 전에 오류를 텍스트 채널로 전송
      if (userMessage && this.textChannel) {
        try {
          await this.textChannel.send(userMessage);
        } catch (_) {}
      }
      trackState.shiftNext(this);
      await this.play(null, 0);
    } else {
      trackState.setCurrent(this, null);
      // 시작/마지막 곡 실패 정리: 오디오플레이어를 정지해 '말하는 중'(speaking) 상태·유령 재생을 해제.
      // 사용자 알림은 호출자(명령 editReply / 대시보드 응답)가 play() 반환값으로 처리 —
      // 여기서 textChannel로 또 보내면 중복이 되므로 전송하지 않는다.
      try {
        this.audioPlayer.stop(true);
      } catch (_) {}
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
    this.warmer.stop();
    this.persistence.stopStateSync();
  }

  scheduleStatePersist(reason = "update", delay = 200) {
    this.persistence.scheduleStatePersist(reason, delay);
  }

  cleanup(isShutdown = false, reason = null) {
    try {
      if (!isShutdown) {
        this.updateVoiceStatus("").catch(() => {});
      }

      this.sponsorSkipper?.stop();
      this.clearInactivityTimer(false);
      this.stopStateSync();

      // 종료 중에는 정리 전에 상태 저장
      if (isShutdown) {
        this.persistState("shutdown").catch(() => {});
      } else {
        this.persistence?.removeSession();
      }

      if (!isShutdown) {
        this.currentDownloadedFile = null;
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

      // 음성 채널 연결 해제.
      // 여기서 나가는 경우가 무음이면 "왜 나갔는지"를 사후에 알 수 없다 —
      // 비활성 타임아웃·헬스체크·대기열 소진이 전부 이 경로를 지난다.
      if (this.connection) {
        this.connection.removeAllListeners();
        if (this.connection.state && this.connection.state.status !== "destroyed") {
          try {
            this.connection.destroy();
            log.info(`음성 채널 떠남: "${this.voiceChannel?.name ?? this.voiceChannel?.id ?? "?"}" (${this.guild?.name ?? this.guild?.id}) | 원인=${reason ?? (isShutdown ? "종료" : "정리")}`);
          } catch (error) {
            log.error("음성 연결 종료 실패:", error);
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

      // 플레이어 데이터 정리 — 보호 해제가 currentTrack을 읽으므로 먼저
      this.releaseAudioProtection();
      trackState.reset(this, { history: true });
      this.startTime = null;
      this.pausedTime = 0;
      this.currentTrackCache = null;
      this.activeStreamInfo = null;

      // 복구 데이터 정리
      this.isRecovering = false;
      this.recoveryAttempts = 0;
      this.lastPlaybackPosition = 0;
      this.currentTrackStartOffsetMs = 0;

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
      log.error("정리 중 오류:", error);
    }
  }

  async updateVoiceStatus(status) {
    try {
      const channel = this.voiceChannel ? this.guild.channels.cache.get(this.voiceChannel.id) : null;
      if (!channel) return;

      const perms = channel.permissionsFor(this.guild.members.me);
      if (!perms?.has(PermissionFlagsBits.SetVoiceChannelStatus)) return;

      // 사람이 적어 둔 상태는 건드리지 않는다. 현재 값은 게이트웨이로만 알 수 있다(voiceChannelStatus).
      if (!voiceChannelStatus.canWrite(channel.id)) return;

      await this.guild.client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: status ?? "" } });
      voiceChannelStatus.mark(channel.id, status ?? "");
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
      currentTrack: this.currentTrack,
      voiceChannel: this.voiceChannel?.name,
      textChannel: this.textChannel?.name,
    };
  }

  // 실제 재생이 시작됐는지(오디오 리소스가 물린 상태) — Idle이면 아직 해석/셋업 중이거나 정지.
  // 대시보드가 '재생 시작 전'에는 currentTrack을 노출하지 않도록 게이팅하는 데 쓴다(유령 재생 방지).
  isPlaybackActive() {
    const status = this.audioPlayer?.state?.status;
    return status !== undefined && status !== AudioPlayerStatus.Idle;
  }
}

module.exports = MusicPlayer;
