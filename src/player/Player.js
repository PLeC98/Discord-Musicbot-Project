import { AudioPlayerStatus, createAudioPlayer, createAudioResource, joinVoiceChannel, entersState } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
// 워치독·상태 전이는 재생 로그와 섞이면 묻힌다. 대시보드에서도 별도 필터가 생긴다
import loggerModule from "../infra/log/logger.ts";
const wlog = loggerModule.child({ category: "watchdog" });
import YouTube from "../sources/youtube/index.js";
import genreConfig from "../config/genres.js";
// 사용자·대시보드가 일으킨 조작. 워치독 분석에서 "사람이 넘긴 것"과 "봇이 자른 것"을 갈라야 한다
import loggerModule2 from "../infra/log/logger.ts";
const clog = loggerModule2.child({ category: "control" });
// 곡을 못 틀었을 때의 오류. 오류 안내와 같은 분류에 남긴다
import loggerModule3 from "../infra/log/logger.ts";
const elog = loggerModule3.child({ category: "error" });
import { PermissionFlagsBits } from "discord.js";

import config from "../../config.js";
import autoplayRoute from "../autoplay/route.js";
import { errorKind } from "../rules/errorKind.ts";
import streamUrl from "../sources/streamUrl.js";
import SponsorSkipper from "./sponsorSkipper.js";
import DirectLink from "../sources/direct.js";
import chunkedStream from "../media/chunkedStream.js";
const { openChunkedStream } = chunkedStream;
import playbackInput from "../media/playbackInput.js";
const { openInput } = playbackInput;
import voiceChannelStatus from "./voiceChannelStatus.js";
import audioCache from "../store/audioCache.js";
import VoiceConnectionManager from "./voiceConnection.js";
import PlaybackWatch from "./playbackWatch.js";
import IdleLeave from "./idleLeave.js";
import PlaybackState from "./playbackState.js";
import CurrentPlayback from "./currentPlayback.js";
import playerEvents from "./events.js";
import startPlayback from "./startPlayback.js";
const { prepareStart, resolveSource, commitPlaying } = startPlayback;
import TrackDownloader from "../media/cacheDownload.js";
import createPlayerSessionId from "./playerSessionId.js";
import SessionPersistence from "./sessionMirror.js";
import QueueWarmer from "./queueWarmer.js";
import trackState from "./trackState.js";
import process from "../media/ffmpeg/process.js";
const { spawnFfmpeg } = process;
import { transportOf } from "../rules/transportOf.ts";
import args from "../media/ffmpeg/args.js";
const { buildFfmpegArgs } = args;
import { inputKind } from "../rules/inputKind.ts";
import { audioKeyOf } from "../rules/audioKeyOf.ts";
import path from "../media/ffmpeg/path.js";
const { capabilities: ffmpegCapabilities } = path;

// 무이음 전환 상수. .env로 빼지 않는다. 자연스러운 값의 범위가 좁게 정해져 있어
// 사용자가 조정해서 나아질 여지가 없다.
const SWITCH_LEAD_MS = 2000; // 전환 지점을 현재보다 얼마나 앞에 잡는가 (캐시 디코더 기동 실측 43ms)
const MAX_TRACK_RETRIES = 2; // 끊긴 곡을 끊긴 위치부터 다시 트는 횟수
const MAX_LIVE_REOPENS = 5; // 라이브가 끊겼을 때 주소를 새로 받아 다시 여는 횟수
const LIVE_REOPEN_DELAY_MS = 1000; // 재시도 간격의 단위. 시도 횟수에 비례해 늘린다

// 채널 알림을 못 보낸 것(권한 · 지워진 채널)은 재생을 막지 않는다
const noticeFailed = (error) => log.warn(`채널 알림을 보내지 못했습니다: ${error?.message || error}`);

const sec = (ms) => (ms == null ? "?" : (ms / 1000).toFixed(1));

// 바깥 경계: 음성 라이브러리 · ffmpeg · 청크 스트림 · HTTP · 직접 링크 · 스트림 주소. 기본은 진짜다.
// 음성 연결 · 세션 저장 · 대기열 미리 받기를 만드는 함수도 여기 둔다. 하네스가 가짜 협력 모듈을 넘기는 자리다.
// 테스트는 생성자에 넘기거나, 플레이어를 직접 만들지 않는 경로(명령 · 곡 추가)를 시험할 때 useBoundary 로 기본을 바꾼다
const REAL = {
  createAudioPlayer,
  createAudioResource,
  spawnFfmpeg,
  ffmpegCapabilities,
  openChunkedStream,
  fetch: (url, init) => fetch(url, init),
  directStream: (url) => DirectLink.getStream(url),
  getStream: (track, seekSeconds, options) => streamUrl.getStream(track, seekSeconds, options),
  joinVoiceChannel,
  entersState,
  createVoice: (player) => new VoiceConnectionManager(player, player.io),
  createPersistence: (player) => new SessionPersistence(player),
  createWarmer: (player, deps) => new QueueWarmer(player, deps),
};
let defaultBoundary = REAL;

class MusicPlayer {
  constructor(guild, textChannel, voiceChannel, boundary = {}) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.io = { ...defaultBoundary, ...boundary };

    // 오디오 플레이어 설정
    this.audioPlayer = this.io.createAudioPlayer();
    this.connection = null;
    this.playback = null; // 지금 트는 한 번(CurrentPlayback). 곡이 바뀌면 버린다

    // 대기열 관리. 현재곡·대기열·기록은 trackState로만 바꾼다
    trackState.init(this);
    // 캐시 퇴거 보호 중인 캐시 열쇠. currentTrack과 별도로 기억,
    // 종료 경로가 currentTrack을 먼저 null해도 해제가 누락되지 않게
    this._protectedAudioKey = null;

    // 플레이어 설정
    this.volume = config.bot.defaultVolume;
    this.loop = false; // false, 'track', 'queue' 중 하나
    this.autoplay = false; // false 또는 장르 문자열: 'pop', 'rock', 'hiphop' 등
    this.paused = false;

    // UI 관리
    this.nowPlayingMessage = null;
    this.requesterId = null;

    // 세션 관리 - 오래된 버튼 상호작용을 막기 위한 고유 ID
    this.sessionId = createPlayerSessionId();

    // 재생 생명주기 상태
    this.pendingEndReason = null;
    this.currentTrackRetries = 0;
    this.lifecycle = new PlaybackState(() => this._trackLabel()); // 재생 단계와 끝 처리 중인가
    this.lastPlaybackPosition = 0; // 재생이 없을 때(복원 직후 등) 알려 줄 위치

    // 일시정지 관리
    this.pauseReasons = new Set();

    // 협력 모듈. 각자 자기 상태와 타이머를 가진다
    this.voice = this.io.createVoice(this);
    this.watch = new PlaybackWatch(this); // 종료 감시 · 버퍼링 감시
    this.idle = new IdleLeave(this); // 혼자 남음 · 틀 게 없음 퇴장
    this.downloader = new TrackDownloader(this);
    this.persistence = this.io.createPersistence(this);
    this.trackSink = this.persistence; // trackState가 바뀐 것을 저장으로 알린다
    this.warmer = this.io.createWarmer(this, {
      warm: (track) => this.downloader.warm(track),
      isCached: (track) => this.downloader.isCached(track),
      isBusy: (track) => TrackDownloader.isDownloading(this.downloader.trackFilePath(track)),
      keyOf: (track) => audioKeyOf(track?.audioUrl),
      setProtection: (guildId, keys) => audioCache.setQueuedKeys(guildId, keys),
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
      this.paused = false;
      if (this.currentTrack) {
        const { playingPrefix } = config.voiceStatus;
        this.updateVoiceStatus(`${playingPrefix}${this.currentTrack.title}`).catch(() => {});
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
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
        const heldMs = this.watch.bufferingSince ? Date.now() - this.watch.bufferingSince : null;
        this.watch.stopBuffering();
        if (heldMs !== null) {
          const line = `상태 전이: buffering → ${newState.status} | ${this._trackLabel()} | 버퍼링 ${(heldMs / 1000).toFixed(1)}s`;
          if (heldMs >= 3000) wlog.warn(`${line} 오래 걸림`);
          else wlog.debug(line);
        }
        return;
      }

      wlog.debug(`재생 상태 전이: ${oldState.status} → ${newState.status} | ${this._trackLabel()}`);

      if (newState.status === AudioPlayerStatus.Buffering) this.watch.startBuffering();
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

  // ── 음성 연결. 연결 복구 상태와 헬스체크는 VoiceConnectionManager 가 가진다 ──

  /** 지금 재생의 오디오 리소스. 없으면 null */
  get resource() {
    return this.playback?.resource ?? null;
  }

  /** 지금 곡이 라이브인가. 틀고 있으면 이번 재생의 답, 아직 모르면 담을 때의 답 */
  get isLive() {
    const pb = this.playback;
    if (pb && pb.track === this.currentTrack && pb.isLive != null) return pb.isLive;
    return Boolean(this.currentTrack?.isLive);
  }

  /** 지금 곡의 SponsorBlock 구간 · 하이라이트. 틀고 있을 때만 있다 */
  get sponsor() {
    const pb = this.playback;
    return pb && pb.track === this.currentTrack ? pb.sponsor : null;
  }

  /** play() 가 곡을 여는 중인가(자동 스킵 · 대시보드 탐색이 끼어들지 않게 본다) */
  get isPlayStarting() {
    return this.lifecycle.starting;
  }

  /** 음성 연결을 스스로 복구하는 중인가(바깥의 복구 감시가 방해하지 않게 본다) */
  get isRecovering() {
    return this.voice?.isRecovering ?? false;
  }

  connect() {
    return this.voice.connect();
  }

  /** 음성 연결이 복구됐다(voiceConnection 이 알린다). 끊긴 위치에서 다시 튼다. 못 틀면 곡을 오류로 끝낸다 */
  async onVoiceRecovered() {
    if (!this.currentTrack) return;
    try {
      await this.play(this.getCurrentTime());
    } catch (error) {
      log.error("재생 재개 실패:", error);
      await this.handleTrackEnd("error");
    }
  }

  disconnect(reason) {
    return this.voice.disconnect(reason);
  }

  // ── 재생. 단계는 startPlayback, 소리를 여는 것은 media/playbackInput ──────

  async play(seekMs = 0) {
    // 재진입 가드. play()가 셋업(스트림/다운로드) 중일 때 워처의 자동 스킵 seek가
    // 겹쳐 들어오면 비캐시 곡의 재생이 깨진다(버그). starting 동안 워처는 발동을 미룬다.
    this.lifecycle.to("starting");
    try {
      const start = await prepareStart(this, seekMs);
      if (!start.ok) return start;

      // 새 재생. 위치 재개는 직전 재생이 남긴 스트림 정보를 쓴다(같은 곡일 때만)
      this.pendingEndReason = null;
      const previous = this.playback;
      const pb = (this.playback = new CurrentPlayback(this.currentTrack, { startOffsetMs: start.startMs }));
      this.lastPlaybackPosition = start.startMs;
      const track = pb.track;

      const source = await resolveSource(this, track, start.startMs, previous?.resume);
      const { streamInfo, cacheFile } = source;
      pb.isLive = source.isLive;
      const transport = (pb.transport = transportOf({ file: cacheFile, streamUrl: streamInfo?.url, streamInfo }));
      pb.live = transport.live; // 끝 처리가 재연결 여부를 이걸로 가른다

      const input = await openInput({
        io: this.io,
        transport,
        streamInfo,
        cacheFile,
        startMs: start.startMs,
        meta: { title: track.title, url: track.pageUrl, duration: track.duration },
        // 스트림은 있지만 캐시 파일이 없으면 나란히 받는다. 라이브는 캐시하지 않는다
        download: !cacheFile && transport.cacheable ? { start: () => this._startBackgroundDownload(), filePath: this.downloader.trackFilePath(track), wait: (file) => TrackDownloader.waitFor(file) } : null,
        // 오류는 곡이 바뀐 뒤에 도착할 수 있다. 이 재생의 곡을 붙잡아 두어 엉뚱한 곡의 캐시로 갈아타지 않게 한다
        onStreamLost: (splicer) => this._planCacheSwitch(splicer, track),
        onProgress: () => {
          pb.inputProgressAt = Date.now();
        },
        onExit: (code) => {
          pb.liveExitCode = code;
        },
        label: this._trackLabel(track),
      });
      if (!input.resource) throw new Error("Failed to create audio resource");
      pb.resource = input.resource;
      pb.cacheFile = input.cacheFile;

      await commitPlaying(this, pb, source);
      this.lifecycle.to("playing");
      return { ok: true, track: this.currentTrack };
    } catch (error) {
      elog.error({ sub: "MusicPlayer.play", kind: errorKind(error) }, `${error?.message || error}`);
      await this.handleError(error, { tell: true });
      return { ok: false, code: "play-failed", error };
    } finally {
      // 틀지 못하고 나왔다(대기열이 비었거나 실패). 실패 처리가 다음 곡을 틀었으면 그쪽 단계가 이미 섰다
      if (this.lifecycle.starting) this.lifecycle.to("idle", "시작 못 함");
    }
  }

  /** 즉시 재생과 나란히 캐시를 받아 둔다. 기다리지 않으며, 실패해도 재생은 스트림으로 계속된다. */
  _startBackgroundDownload() {
    // currentTrack은 다운로드가 끝나기 전에 바뀔 수 있다. 지금 곡을 붙잡아 둔다
    const trackToDownload = this.currentTrack;
    this.downloader
      .downloadTrack(trackToDownload)
      .then((file) => {
        log.debug(`백그라운드 캐시 다운로드 끝: ${this._trackLabel(trackToDownload)} → ${file}`);
      })
      .catch((err) => {
        if (err && err.message) {
          log.warn(`백그라운드 캐시 다운로드 실패: ${YouTube.briefError(err)}. 재생은 스트림으로 계속됩니다.`);
        }
      });
  }

  /**
   * 스트림이 죽었을 때 캐시 파일로 소리 없이 갈아탄다. 예약했으면 true.
   * 캐시가 아직 없으면 하지 않는다. 스트림이 이어받거나, Idle → play(위치)가 받는다.
   */
  _planCacheSwitch(splicer, track) {
    const giveUp = (why) => {
      wlog.debug(`무지연 전환 포기: ${this._trackLabel()} | ${why}`);
      return false;
    };

    if (!splicer || splicer.destroyed || splicer.switchPending) return giveUp("전환할 수 있는 상태가 아님");
    // 늦게 도착한 오류가 다음 곡의 재생을 건드리지 않도록
    if (!track || this.currentTrack !== track) return giveUp("이미 다른 곡으로 넘어감");

    const file = TrackDownloader.findCacheFile(track);
    if (!file) return giveUp("쓸 수 있는 캐시 파일이 없음");

    // 전환 지점은 스플라이서 출력 기준이다. 리소스는 그보다 뒤처져 있으므로
    // resource.playbackDuration을 쓰면 자기 정합적이지 않다.
    const atMs = splicer.emittedMs + SWITCH_LEAD_MS;
    const seekMs = (this.playback?.startOffsetMs || 0) + atMs; // 캐시 파일 안에서의 절대 위치

    let decoder;
    try {
      decoder = this.io.spawnFfmpeg(buildFfmpegArgs({ file, seekMs }), "switch");
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

  // 로그용 트랙 식별
  _trackLabel(track = this.currentTrack) {
    return `"${track?.title ?? "?"}" (${track?.platform ?? "?"})`;
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

    // 버퍼링 중이면 의도만 받아 둔다. 재생으로 넘어오는 순간 Playing 리스너가 멈춘다
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

  /**
   * 이 플레이어가 아직 이 서버의 현행 플레이어인가.
   *
   * 교체되고도 남아 있던 타이머가 뒤늦게 깨어나면 다른 플레이어의 등록과 음성 연결을 건드린다.
   * 지연 실행되는 정리 경로는 반드시 이걸로 자기 차례인지 확인한다.
   */
  _isActivePlayer() {
    return this.guild?.client?.players?.get(this.guild.id) === this;
  }

  /**
   * 재생 상태나 저장된 세션 데이터를 건드리지 않고 모든 반복 타이머를 해제.
   * 플레이어가 폐기될 때마다 (stop/leave/접속 실패) 호출해야 함.
   * 그렇지 않으면 30초 상태 검사 interval이 플레이어 객체를 영원히 붙잡습니다.
   */
  releaseResources() {
    this.idle.stop();
    this.stopStateSync();
    this.voice.stopConnectionRecovery();
    this.voice.stopHealthCheck();
    this.watch.stop();
  }

  // 재생 중 트랙의 캐시 퇴거 보호 해제. currentTrack이 이미 null이어도 기억된 키로 해제
  releaseAudioProtection() {
    const key = this._protectedAudioKey || audioKeyOf(this.currentTrack?.audioUrl);
    if (key) audioCache.unprotect(key);
    this._protectedAudioKey = null;
  }

  /** /stop · 정지 버튼 · 대시보드. 세션을 지운다. 부른 쪽이 이어서 패널을 끝낸다 */
  stop() {
    clog.info(`정지: ${this._trackLabel()} | 대기열 ${this.queue?.length ?? 0}곡 비움`);
    this.dispose({ reason: "정지", keepPanel: true });
  }

  /** /leave. 세션을 남겨 /join 이 복구한다. 부른 쪽이 이어서 패널을 끝낸다 */
  leaveAndSave() {
    return this.dispose({ reason: "나가며 저장", keepSession: true, keepPanel: true });
  }

  /** 봇이 스스로 나갈 때(비활성 · 대기열 소진 · 헬스체크 · 강제 퇴장 · 복원 실패 · 운영자). 세션과 패널 참조를 지운다 */
  cleanup(reason = "정리") {
    this.dispose({ reason });
  }

  /**
   * 이 플레이어를 버린다. 부른 뒤에는 레지스트리에서 빼고 다시 쓰지 않는다.
   * @param {object} o
   * @param {string} o.reason  로그에 남길 원인
   * @param {boolean} [o.keepSession]  세션을 남긴다(비우기 전에 저장한다). 아니면 지운다
   * @param {boolean} [o.keepPanel]  패널 참조를 남긴다. 부른 쪽이 이어서 살아 있는 패널을 끝낸다
   */
  async dispose({ reason, keepSession = false, keepPanel = false }) {
    this.lifecycle.to("disposed", reason);
    try {
      this.updateVoiceStatus("").catch(() => {});
      if (keepSession) await this.persistState("leave", true);
      else this.persistence?.removeSession();

      this.sponsorSkipper?.stop();
      this.pauseReasons.clear();
      this.paused = false;
      this.releaseResources();
      this.releaseAudioProtection(); // currentTrack 을 읽으므로 비우기 전에

      // 종료 로그가 뒤늦게(Idle 이후) 도는데 여기서 currentTrack을 비우므로 라벨만 남겨둔다
      this._endingLabel = this._trackLabel();
      trackState.reset(this, { history: true });
      this.pendingEndReason = "stop";
      this.audioPlayer.stop(true);
      this.audioPlayer.removeAllListeners();
      try {
        this.playback?.resource?.playStream?.destroy();
      } catch {
        // 스트림이 이미 제거되었을 수 있음
      }
      this.playback = null;
      this.lastPlaybackPosition = 0;
      this.voice.disconnect(reason);

      if (!keepPanel) this._dropPanel();
    } catch (error) {
      log.error("정리 중 오류:", error);
    }
  }

  // 패널 참조를 놓는다. 남은 패널은 ui 가 기록으로 찾아 끝낸다
  _dropPanel() {
    this.nowPlayingMessage = null;
    this.requesterId = null;
    this.voiceChannel = null;
    if (this.textChannel?.id) playerEvents.released(this, this.textChannel.id);
    this.textChannel = null;
  }

  /**
   * 재생 위치 이동. `/seek`·`/replay`·`/highlight`·대시보드가 전부 여기를 지난다.
   *
   * 각 진입점이 `play(ms)`를 직접 부르면 로그에서 사람이 위치를 옮긴 것과 봇이 다음 곡으로
   * 넘어간 것을 가릴 수 없다. 진입점마다 로그를 다는 대신 통로를 하나로 둔다.
   *
   * @param {number} seekMs  이동할 위치(ms)
   * @param {string} reason  누가 시켰나. "seek" | "replay" | "highlight" | "dashboard"
   */
  seek(seekMs, reason = "seek") {
    // 라이브에는 실시간밖에 없다. 되감을 자리도, 앞서 갈 자리도 없다.
    if (this.isLive) {
      clog.info(`위치 이동 거부: ${this._trackLabel()} | 라이브 | 원인=${reason}`);
      return { ok: false, code: "live-no-seek" };
    }
    const from = Math.round((this.lastPlaybackPosition || 0) / 1000);
    clog.info(`위치 이동: ${this._trackLabel()} | ${from}초 → ${Math.round(seekMs / 1000)}초 | 원인=${reason}`);
    return this.play(seekMs);
  }

  // reason: "skip"(기본) 또는 "jump"(대기열 점프. 한곡 반복 중에도 재시작이 아니라 선택 곡으로 이동)
  skip(reason = "skip") {
    if (this.currentTrack) {
      clog.info(`스킵: ${this._trackLabel()} | 원인=${reason} | 대기열 ${this.queue?.length ?? 0}곡`);
      // 트랙 타이머 정리
      this.watch.stopEnd();
      this.idle.cancelEmpty();

      this.pendingEndReason = reason;
      this.audioPlayer.stop(true);
      this.scheduleStatePersist("skip", 0);
      return true;
    }
    return false;
  }

  previous() {
    // 틀고 있는 곡이 없으면 멈출 것도 없다. 멈춤이 곡 끝을 부르지 않아 되감은 곡이 대기열에 걸린 채 남는다
    if (!this.currentTrack) return false;
    clog.info(`이전곡: ${this._trackLabel()} | 이전 기록 ${this.previousTracks?.length ?? 0}곡 | 반복=${this.loop || "off"}`);
    // 한곡 반복 중 이전곡 = 현재 곡 재시작. 대기열·기록 불변.
    if (this.loop === "track") {
      this.watch.stopEnd();
      this.pendingEndReason = "previous";
      this.audioPlayer.stop(true);
      this.scheduleStatePersist("previous", 0);
      return true;
    }

    if (this.previousTracks.length > 0) {
      // 현재 트랙은 currentTrack으로 남겨 handleTrackEnd가 기록하게 한다. 여기서 이전 트랙을
      // 미리 할당하면 "예기치 않게 종료됨" 재시도 로직이 그 곡을 중간부터 재개한다.
      trackState.rewind(this);

      this.watch.stopEnd();

      this.pendingEndReason = "previous";
      this.audioPlayer.stop(true);
      this.scheduleStatePersist("previous", 0);
      return true;
    }
    return false;
  }

  setVolume(volume) {
    // 조작 로그는 부르는 쪽(usecases/controls)이 잇단 변경을 모아 한 줄로 남긴다
    this.volume = Math.max(0, Math.min(100, volume));
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
    if (this.isLive) return true;
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
   * 그러면 대기열이 저절로 늘어난 이유를 로그에서 찾을 수 없다. 곡이 붙는 것만 보이고
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

  /** 곡 안의 지금 위치(ms). 리소스가 실제로 낸 양이라 멈춤 · 버퍼링은 세지 않는다 */
  getCurrentTime() {
    const pb = this.playback;
    if (!pb) return this.lastPlaybackPosition || 0;
    return (pb.startOffsetMs || 0) + (pb.resource?.playbackDuration || 0);
  }

  // 곡 끝 처리. 다시 틀기 · 한곡 반복 · 다음 곡 · 자동재생 · 대기열 소진을 가른다
  async handleTrackEnd(reason = "idle") {
    if (!this.lifecycle.beginEnd()) return; // 끝이 겹쳐 들어왔다. 먼저 온 것이 처리한다
    if (this.lifecycle.phase === "playing") this.lifecycle.to("idle", `곡 끝(${reason})`);
    this.sponsorSkipper?.stop(); // 다음 트랙 play()가 onPlayStart로 다시 가동

    try {
      this.watch.stopEnd();

      const finishedTrack = this.currentTrack;
      this.releaseAudioProtection();
      const totalPlaybackMs = this.getCurrentTime();
      this.lastPlaybackPosition = totalPlaybackMs;
      const durationMs = finishedTrack && Number(finishedTrack.duration) > 0 ? Number(finishedTrack.duration) * 1000 : 0;
      // "sponsorblock"(아웃트로 종료)은 스킵 버튼과 동일하게 트랙 완료로 취급. 조기 드롭 복구 대상 아님.
      const manualSkip = reason === "skip" || reason === "stop" || reason === "previous" || reason === "jump" || reason === "sponsorblock";
      const endedUnexpectedly = Boolean(finishedTrack) && !manualSkip && durationMs > 0 && totalPlaybackMs + 1500 < durationMs;
      // 라이브는 길이가 없어 "일찍 끝났다"로 가를 수 없다. ffmpeg의 종료 코드로 가른다.
      // 0이면 방송이 끝난 것(EOF)이라 다음 곡으로 넘기고, 그 밖은 사고라 다시 연다.
      const liveDropped = Boolean(this.playback?.live) && !manualSkip && this.playback.liveExitCode !== 0;

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
            await this.play(0);
            return;
          }
          log.error(`라이브를 다시 열지 못해 다음 곡으로 넘깁니다: ${endedLabel} | 재시도 ${MAX_LIVE_REOPENS}회 소진`);
        } else if (this.currentTrackRetries <= MAX_TRACK_RETRIES) {
          log.warn({ tags: ["retry"] }, `재생이 끊겨 ${at} 지점부터 다시 재생합니다: ${endedLabel} (${this.currentTrackRetries}/${MAX_TRACK_RETRIES})`);
          await this.play(totalPlaybackMs);
          return;
        } else {
          log.error(`재생을 복구하지 못해 다음 곡으로 넘깁니다: ${endedLabel} | ${at} 지점, 재시도 ${MAX_TRACK_RETRIES}회 소진`);
        }
      } else {
        this.currentTrackRetries = 0;
      }

      if (!finishedTrack) {
        this.playback = null;
        return;
      }

      if (this.loop === "track" && reason !== "stop" && reason !== "jump") {
        // 한곡 반복: 자연 종료·스킵·이전곡 모두 현재 곡을 처음부터 다시 재생
        // 대기열·이전 곡 기록은 불변. 다음 곡으로 넘어가려면 반복 해제 또는 대기열 점프(jump).
        await this.play(0);
        return;
      }
      if (reason !== "previous") {
        trackState.retire(this, finishedTrack, { requeue: this.loop === "queue" });
      }

      this.playback = null;
      this.lastPlaybackPosition = 0;

      if (this.queue.length > 0) {
        trackState.shiftNext(this);

        // 다음 트랙을 처음부터 재생
        await this.play(0);
        await playerEvents.refresh(this);

        return;
      }

      if (this.autoplay) {
        const { genres } = genreConfig.genres();
        if (!genres[this.autoplay]) {
          // 알 수 없는 장르(장르 목록 변경 전에 저장된 세션 등). 끄고 알린 뒤 아래의 일반 대기열 종료 흐름으로
          log.warn(`자동재생을 종료합니다. 알 수 없는 장르: ${this.autoplay}`);
          playerEvents.notice(this, "autoplay-unknown-genre", { genre: this.autoplay }).catch(noticeFailed);
          this.autoplay = false;
        } else {
          this.currentTrackRetries = 0;
          // 틀었을 때만 여기서 끝낸다. 못 골랐으면 아래 대기열 소진 흐름으로 떨어진다.
          // 그냥 return하면 현재곡이 끝난 곡을 가리킨 채 남아 곡 추가·스킵이 전부 먹통이 된다.
          // 이때 자동재생은 켜 둔 채로 둔다. 후보를 한 번 못 찾은 것이 장르를 끌 이유는 아니다.
          if (await this.handleAutoplay()) return;
        }
      }

      // 다 끝났다. 다음 재생은 새로 시작하는 것이라 이전 곡 기록도 비운다
      trackState.reset(this, { history: true });

      this.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});

      await playerEvents.ended(this, "queue-end");

      this.idle.cancelAlone(false);
      this.persistence?.removeSession();

      this.idle.scheduleEmpty();
    } finally {
      this.lifecycle.finishEnd();
      this.pendingEndReason = null;
    }
  }

  /**
   * 자동재생 후보 한 곡을 고른다. 못 고르면 null.
   *
   * 고르기만 한다. 대기열도 재생도 건드리지 않는다. 부르는 쪽이 지금 틀지(handleAutoplay)
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

      // autoplayDeps: 길 찾기의 바깥 경계(소스 · 검색 · 장부 · AI 보조). 테스트만 넘긴다. 없으면 진짜
      const picked = await autoplayRoute.pickTrack(cfg, recent, this.autoplayDeps);
      if (!picked) {
        log.warn(`자동재생: 어느 소스에서도 곡을 찾지 못했습니다 (장르 ${this.autoplay})`);
        return null;
      }

      picked.requestedBy = this.guild.members.me.user;
      picked.addedAt = Date.now();
      picked.autoplay = true; // 대기열 표시·정리에서 사용자 곡과 가른다

      // 어디서 어떻게 왔는지 한 줄. 소스가 여럿이 되면서 "이 곡이 왜 나왔지"를 로그로 되짚을 수
      // 있어야 한다. 재생·종료 쪽에는 출처가 찍히는데 정작 고르는 자리에 없었다.
      // platform 으로는 못 가른다. 음원을 직접 트는 곡도 platform 은 출처 이름(anisongdb 등)이다.
      // 소리가 어디서 오는지는 음원 주소가 가른다.
      const how = `${inputKind(picked.audioUrl) === "direct" ? "음원 직접" : `유튜브 ${picked.audioUrl}`}${picked.audioFoundBy === "ledger" ? " (매핑 재사용, 검색 생략)" : ""}`;
      clog.info(`자동재생 뽑기: "${picked.title}" / ${picked.artist || "?"} (장르 ${this.autoplay}, 소스 ${picked.pickedFrom || "?"} → ${how})`);
      return picked;
    } catch (error) {
      log.error("자동재생 오류:", error.message);
      return null;
    }
  }

  /**
   * 틀 것이 하나도 없을 때. 아무거나 틀지 않고 알린 뒤 끈다.
   *
   * 조용히 멈추면 무엇이 잘못됐는지 알 길이 없다. pickTrack은 이미 모든 소스를 훑고 오므로
   * 여기까지 왔다는 것은 한 번 삐끗한 것이 아니라 정말로 낼 것이 없다는 뜻이다.
   */
  _giveUpAutoplay() {
    if (!this.autoplay) return;
    const genre = this.autoplay;
    log.warn(`자동재생을 종료합니다. 곡을 찾지 못했습니다 (장르 ${genre})`);
    playerEvents.notice(this, "autoplay-gave-up", { genre }).catch(noticeFailed);
    this.setAutoplay(false);
  }

  /** 지금 골라서 바로 튼다. 곡이 끝났을 때와, 아무것도 안 틀고 있을 때 켠 경우. 틀었으면 true. */
  async handleAutoplay() {
    const picked = await this.pickAutoplayTrack();
    if (!picked) {
      // 미리 뽑기(ensureAutoplayNext)에서는 끄지 않는다. 거기서는 못 골라도 여기서 다시 해 본다.
      this._giveUpAutoplay();
      return false;
    }

    trackState.enqueue(this, [picked]);
    trackState.shiftNext(this);
    await this.play(0);

    // 패널이 없을 수 있다. 아무것도 안 틀던 서버에서 자동재생으로 처음 트는 길.
    // 패널 고치기는 있는 패널을 고칠 뿐이라, 그대로 두면 소리만 나고 화면이 없다.
    if (this.nowPlayingMessage) await playerEvents.refresh(this);
    else await playerEvents.started(this, this.guild.members.me.user);
    return true;
  }

  /**
   * 곡이 시작될 때 다음 자동재생 곡을 미리 대기열에 둔다.
   *
   * 그래야 QueueWarmer가 평소처럼 받아 두고 전환이 즉시가 된다. 곡이 끝난 뒤에 검색을 시작하면
   * 대기열에 머무는 시간이 0이라 받아 둘 틈이 없다.
   *
   * 부르는 쪽은 기다리지 않는다. 검색에 몇 초가 걸리는데 그걸 기다리면 재생 시작이 늦어진다.
   */
  async ensureAutoplayNext() {
    if (this._autoplayPicking) return false; // 고르는 중. 겹쳐 부르면 두 곡이 들어간다
    if (!this._canPrefetchAutoplay()) return false;

    this._autoplayPicking = true;
    try {
      // prefetchCount만큼 채운다. 한 번에 한 곡만 넣으면 값을 키워도 늘 한 곡 앞만 보게 된다
      // 부르는 쪽은 곡이 시작할 때 한 번 부를 뿐이라 다시 불러 주는 사람이 없기 때문이다.
      //
      // 다만 쉬지 않고 연달아 뽑지는 않는다. 뽑기 한 번에 유튜브 검색이 여러 번 나가므로
      // (소스 재시도 × 검색어) 다섯 곡을 붙여 뽑으면 수십 번이 몇 초 안에 몰린다.
      // 급한 것은 첫 곡뿐이니 나머지는 예열과 같은 간격(preload.gapMs)을 둔다.
      let added = 0;
      while (this._canPrefetchAutoplay()) {
        if (added > 0) {
          await new Promise((done) => setTimeout(done, this._prefetchGapMs ?? config.preload.gapMs));
          if (!this._canPrefetchAutoplay()) break; // 쉬는 사이 사용자가 곡을 넣었을 수 있다
        }

        const picked = await this.pickAutoplayTrack();
        if (!picked) break;
        // 고르는 사이 대기열이 변했을 수 있다. 사용자가 곡을 넣었으면 미리 뽑기는 취소한다.
        if (!this._canPrefetchAutoplay()) break;

        // 골랐다는 줄은 pickAutoplayTrack 이 이미 찍었다. 그쪽이 아티스트와 행선까지 적는다.
        trackState.enqueue(this, [picked]);
        added++;
      }

      if (added) await playerEvents.refresh(this).catch(() => {});
      return added > 0;
    } finally {
      this._autoplayPicking = false;
    }
  }

  // 지금 장르의 자동재생 설정. 기준값 위에 장르 설정을 얹는다. 모르는 장르면 null.
  _autoplayConfig() {
    const { defaults, genres } = genreConfig.genres();
    const genre = genres[this.autoplay];
    // 이름도 같이 넘긴다. AI 보조가 "이 장르가 맞나"를 물을 때 쓴다(autoplayAssist)
    return genre ? { ...defaults, ...genre, genreName: this.autoplay } : null;
  }

  // 미리 뽑아 둘 수 있는 상태인가. 고르기 전과 넣기 직전에 같은 것을 본다.
  _canPrefetchAutoplay() {
    if (!this.autoplay || typeof this.autoplay !== "string") return false;
    if (!this.currentTrack) return false; // 틀고 있는 게 없으면 미리 둘 이유가 없다
    if (this.loop === "track") return false; // 한곡 반복이면 다음 곡으로 넘어가지 않는다
    const want = Number(this._autoplayConfig()?.prefetchCount ?? 1);
    return this.queue.length < Math.max(1, want);
  }

  // tell: 다음 곡으로 넘길 때 무엇이 잘못됐는지 채널에 알린다
  async handleError(error, { tell = false } = {}) {
    // 내려간 영상을 고른 자동재생 곡. 우리가 고른 것이니 사용자에게 알릴 일이 아니다.
    // 기억해 두고(다음에 또 고르지 않게) 조용히 다른 곡으로 넘어간다.
    const failed = this.currentTrack;
    if (failed?.autoplay && YouTube.isVideoUnavailableError(error)) {
      autoplayRoute.markDead(failed);
      log.info(`자동재생 곡을 건너뜁니다(영상 없음): "${failed.title}"`);
      tell = false;
    }

    // 대기열이 비었어도 자동재생 중이면 멈추지 않는다. 그대로 두면 봇이 얼어붙는다.
    if (this.queue.length === 0 && this.autoplay) {
      trackState.setCurrent(this, null);
      if (await this.handleAutoplay()) return;
    }

    // 오류 시 다음 트랙으로 스킵 시도
    if (this.queue.length > 0) {
      // 스킵 전에 오류를 텍스트 채널로 전송
      if (tell) await playerEvents.notice(this, "skipped-after-error", { error }).catch(noticeFailed);
      trackState.shiftNext(this);
      await this.play(0);
    } else {
      trackState.setCurrent(this, null);
      // 시작/마지막 곡 실패 정리: 오디오플레이어를 정지해 '말하는 중'(speaking) 상태·유령 재생을 해제.
      // 사용자 알림은 호출자(명령 editReply / 대시보드 응답)가 play() 반환값으로 처리.
      // 여기서 textChannel로 또 보내면 중복이 되므로 전송하지 않는다.
      try {
        this.audioPlayer.stop(true);
      } catch (_) {}
    }
  }

  // ── 세션 영속화. 로직은 SessionPersistence ────────────────────────────────

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

  // 실제 재생이 시작됐는지(오디오 리소스가 물린 상태). Idle이면 아직 해석/셋업 중이거나 정지.
  // 대시보드가 '재생 시작 전'에는 currentTrack을 노출하지 않도록 게이팅하는 데 쓴다(유령 재생 방지).
  isPlaybackActive() {
    const status = this.audioPlayer?.state?.status;
    return status !== undefined && status !== AudioPlayerStatus.Idle;
  }
}

/** 이 뒤로 만드는 플레이어의 바깥 경계 기본값. 테스트만 쓴다. 인자 없이 부르면 진짜로 돌아간다 */
MusicPlayer.useBoundary = (overrides) => {
  defaultBoundary = overrides ? { ...REAL, ...overrides } : REAL;
};

export default MusicPlayer;
export { MusicPlayer as "module.exports" };
