import { AudioPlayerStatus, createAudioPlayer, createAudioResource, joinVoiceChannel, entersState } from "@discordjs/voice";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
// 워치독·상태 전이는 재생 로그와 섞이면 묻힌다. 대시보드에서도 별도 필터가 생긴다
const wlog = logger.child({ category: "watchdog" });
import * as YouTube from "../sources/youtube/index.ts";
import * as genreConfig from "../config/genres.ts";
// 사용자·대시보드가 일으킨 조작. 워치독 분석에서 "사람이 넘긴 것"과 "봇이 자른 것"을 갈라야 한다
const clog = logger.child({ category: "control" });
// 곡을 못 틀었을 때의 오류. 오류 안내와 같은 분류에 남긴다
const elog = logger.child({ category: "error" });
import { PermissionFlagsBits, type Guild, type GuildTextBasedChannel, type VoiceBasedChannel, type Message, type WebhookClient } from "discord.js";
import type { AudioPlayer, AudioPlayerState, VoiceConnection } from "@discordjs/voice";
import type { QueuedTrack } from "./track.ts";
import type { Loop } from "./trackState.ts";
import type { WarmerDeps } from "./queueWarmer.ts";
import type { AudioSplicer } from "../media/audioSplicer.ts";
import type { Deps as AutoplayDeps } from "../autoplay/route.ts";
import type { StreamOptions } from "../sources/streamUrl.ts";
import type { Seeking } from "../sources/youtube/equivalent.ts";

import config from "../../config.ts";
import * as autoplayRoute from "../autoplay/route.ts";
import { errorKind, messageOf, codedError } from "../rules/errorKind.ts";
import { failureReason } from "../rules/failureReason.ts";
import * as streamUrl from "../sources/streamUrl.ts";
import { SponsorSkipper } from "./sponsorSkipper.ts";
import * as DirectLink from "../sources/direct.ts";
import * as equivalent from "../sources/youtube/equivalent.ts";
import * as SponsorBlock from "../sources/sponsorBlock.ts";
import { openChunkedStream } from "../media/chunkedStream.ts";
import { createFragmentStream } from "../media/fragmentStream.ts";
import { openInput } from "../media/playbackInput.ts";
import { InputHealth } from "../media/inputHealth.ts";
import { endVerdict, type EndFacts } from "../rules/endVerdict.ts";
import { countDrop, FRESH, MAX_LIVE_REOPENS, MAX_TRACK_RETRIES, PROGRESS_MS, type RetryState } from "../rules/retryBudget.ts";
import * as voiceChannelStatus from "./voiceChannelStatus.ts";
import * as audioCache from "../store/audioCache.ts";
import { VoiceLink } from "./voiceLink.ts";
import { PlaybackWatch } from "./playbackWatch.ts";
import { IdleLeave } from "./idleLeave.ts";
import { PlaybackState } from "./playbackState.ts";
import { CurrentPlayback } from "./currentPlayback.ts";
import * as playerEvents from "./events.ts";
import { prepareStart, resolveSource, commitPlaying } from "./startPlayback.ts";
import { TrackDownloader, tooLongToCache } from "../media/cacheDownload.ts";
import { createPlayerSessionId } from "./playerSessionId.ts";
import { SessionPersistence } from "./sessionMirror.ts";
import { QueueWarmer } from "./queueWarmer.ts";
import * as trackState from "./trackState.ts";
import { spawnFfmpeg } from "../media/ffmpeg/process.ts";
import { transportOf } from "../rules/transportOf.ts";
import { buildFfmpegArgs } from "../media/ffmpeg/args.ts";
import { inputKind } from "../rules/inputKind.ts";
import { audioKeyOf } from "../rules/audioKeyOf.ts";
import { capabilities as ffmpegCapabilities } from "../media/ffmpeg/path.ts";
import { bindToGuild } from "../infra/guildContext.ts";
import { bestEffort } from "../infra/bestEffort.ts";

// 무이음 전환 상수. .env로 빼지 않는다. 자연스러운 값의 범위가 좁게 정해져 있어
// 사용자가 조정해서 나아질 여지가 없다.
const SWITCH_LEAD_MS = 2000; // 전환 지점을 현재보다 얼마나 앞에 잡는가 (캐시 디코더 기동 실측 43ms)
const LIVE_REOPEN_DELAY_MS = 1000; // 라이브 다시 열기 간격의 단위. 예산을 쓴 횟수에 비례해 늘린다
const FAILED_TRACKS_LIMIT = 3; // 곡이 연달아 이만큼 실패하면 넘기기를 그만두고 멈춘다
const LENGTH_MISMATCH_LOG_MS = 2000; // 저절로 끝난 위치가 길이와 이만큼 넘게 다르면 남긴다
// 재생 중 공급이 끊겨도 이만큼(20ms 프레임 500개 = 10초) 버틴다. 라이브러리 기본은 5(0.1초).
// 입력 층(청크 스트림 이어받기 · HLS 재접속 · 직접 링크 본문 무응답)이 이보다 먼저 결론 내게 둔다.
// 이 값을 넘으면 플레이어가 멈추고 곡 끝 판정이 "공급이 끊겨 멈춤"으로 그 위치부터 다시 연다
const MAX_MISSED_FRAMES = 500;
const DIRECT_BODY_IDLE_MS = 6000; // 직접 링크를 틀 때 본문 무응답 한도

/** play() 의 결과. 못 틀었으면 까닭(code), 던졌으면 그 오류 */
type PlayResult = { ok: true; track: QueuedTrack | null } | { ok: false; code: "queue-empty" | "live-ended"; error?: undefined } | { ok: false; code: "play-failed" | "live-reopen-failed"; error: unknown };

// 끊긴 라이브를 다시 열었는데 라이브가 아니다(방송이 끝나 다시보기가 됐다)
const endedLive = (liveReopen: boolean, transport: { live: boolean }) => liveReopen && !transport.live;

// 곡이 어떻게 끝났나. dropped: 사고로 끊겼다 · live: 그중 라이브가 끊긴 것
type EndShape = { playedMs: number; label: string; dropped: boolean; live: boolean; why: string };

// 끝 판정에 넘길 사실. 판정은 rules/endVerdict
function endFactsOf(pb: CurrentPlayback | null, reason: string, positionMs: number): EndFacts {
  const live = Boolean(pb?.live);
  const input = pb?.input;
  return {
    reason,
    live,
    streamEnded: streamEndedOf(pb),
    broken: input?.broken ?? null,
    exitCode: input?.exitCode ?? null,
    positionMs,
    lengthMs: live ? null : (pb?.lengthMs ?? null),
  };
}

// 라이브러리는 Idle 로 가며 재생 스트림을 부순다. 끝까지 읽힌 스트림은 부서져도 끝난 것으로 남는다
const streamEndedOf = (pb: CurrentPlayback | null) => pb?.resource?.playStream?.readableEnded ?? true;

// 공급이 끊겨 멈췄을 때 남길 입력 상태. 버티는 시간(MAX_MISSED_FRAMES)이 맞는지 볼 근거다.
// 입력이 마지막으로 들어온 때는 스트림 · 주소 갈래만 적는다(파일과 캐시 전환 뒤에는 없다)
function starvedDetail(pb: CurrentPlayback | null) {
  const input = pb?.input;
  const tracked = input && input.kind !== "캐시 전환" && pb.inputProgressAt;
  const parts = [`입력 ${input?.kind ?? "?"}`];
  if (tracked) parts.push(`입력 없음 ${sec(Date.now() - tracked)}초`);
  const detail = input?.detail();
  if (detail) parts.push(detail);
  return parts.join(" · ");
}

// 채널 알림을 못 보낸 것(권한 · 지워진 채널)은 재생을 막지 않는다
const noticeFailed = (error: unknown) => log.warn(`채널 알림을 보내지 못했습니다: ${messageOf(error)}`);

const sec = (ms: number | null | undefined) => (ms == null ? "?" : (ms / 1000).toFixed(1));

// 바깥 경계: 음성 라이브러리 · ffmpeg · 청크 스트림 · HTTP · 직접 링크 · 스트림 주소. 기본은 진짜다.
// 음성 연결 · 세션 저장 · 대기열 미리 받기 · 캐시 다운로더를 만드는 함수와 동등물 · SponsorBlock 조회도 여기 둔다.
// 하네스가 가짜 협력 모듈을 넘기는 자리다.
// 테스트는 생성자에 넘기거나, 플레이어를 직접 만들지 않는 경로(명령 · 곡 추가)를 시험할 때 useBoundary 로 기본을 바꾼다
const REAL = {
  createAudioPlayer,
  createAudioResource,
  spawnFfmpeg,
  ffmpegCapabilities,
  openChunkedStream,
  openFragmentStream: createFragmentStream,
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  // 재생은 본문 무응답을 짧게 본다. 플레이어가 버티는 10초(MAX_MISSED_FRAMES)보다 먼저 끊겨 곡 끝 판정이 입력 깨짐으로 다시 연다
  directStream: (url: string) => DirectLink.getStream(url, undefined, { bodyIdleMs: DIRECT_BODY_IDLE_MS }),
  getStream: (track: Seeking & { platform?: string | null }, options?: Partial<StreamOptions>) => streamUrl.getStream(track, options),
  joinVoiceChannel,
  entersState,
  createVoice: (player: Player) => new VoiceLink(player, player.io),
  createPersistence: (player: Player) => new SessionPersistence(player),
  createWarmer: (player: Player, deps: WarmerDeps) => new QueueWarmer(player, deps),
  createDownloader: (player: Player) => new TrackDownloader(player),
  findEquivalent: (track: QueuedTrack) => equivalent.findYouTubeEquivalent(track),
  sponsorFor: (track: QueuedTrack, guildId: string) => SponsorBlock.forTrack(track, guildId),
  pickAutoplay: (cfg: Parameters<typeof autoplayRoute.pickTrack>[0], recent: Parameters<typeof autoplayRoute.pickTrack>[1], deps?: AutoplayDeps) => autoplayRoute.pickTrack(cfg, recent, deps),
};
type Boundary = typeof REAL;
/** 무이음 전환에서 스플라이서에게 묻고 부르는 칸 */
type Switchable = Pick<AudioSplicer, "destroyed" | "switchPending" | "emittedMs" | "slips" | "planSwitch"> & { once(event: "switched", listener: (ms: number) => void): unknown };
let defaultBoundary: Boundary = REAL;

/** 재생 패널. 웹훅으로 올렸으면 API 메시지 모양(channel_id), 채널로 보냈으면 Message */
type PanelMessage = Message | { id: string; channel_id: string };
/** 재생 패널을 올린 웹훅. 고치고 지우는 것만 */
type PanelHook = Pick<WebhookClient, "editMessage" | "deleteMessage">;

class Player {
  guild: Guild;
  textChannel: GuildTextBasedChannel | null;
  voiceChannel: VoiceBasedChannel | null;
  io: Boundary;
  audioPlayer: AudioPlayer;
  connection: VoiceConnection | null;
  playback: CurrentPlayback | null;
  // trackState.init 이 채운다
  currentTrack!: QueuedTrack | null;
  queue!: QueuedTrack[];
  previousTracks!: QueuedTrack[];
  _protectedAudioKey: string | null;
  volume: number;
  loop: Loop;
  /** 끄면 false, 켜면 장르 이름 */
  autoplay: string | false;
  paused: boolean;
  // 화면(ui)이 채우는 패널
  nowPlayingMessage: PanelMessage | null;
  nowPlayingWebhook?: PanelHook | null;
  sessionId: string;
  /** 멈춘 까닭. 멈추는 쪽이 _stopWith 로 적고 끝 처리(Idle)가 가져간다 */
  _endReason: string | null;
  /** 끊긴 곡을 다시 연 예산(_retryTrack 의 것). rules/retryBudget */
  retry: RetryState;
  /** 연달아 실패한 곡 수. 소리를 낸 곡이 끝나면 0 */
  failedTracks: number;
  /** 연달아 실패해 멈춰도 글자 채널에 알리지 않는다(세션을 되살리는 /join 이 명령 응답으로 말하는 동안) */
  quietFailures = false;
  /** 곡 담기가 쉬던 플레이어에 첫 곡을 트는 동안. 틀지 못해도 대기열 소진으로 끝내지 않는다(담을 곡이 아직 남았다). 끝은 담기가 맡는다 */
  finishByCaller = false;
  lifecycle: PlaybackState;
  lastPlaybackPosition: number;
  pauseReasons: Set<string>;
  voice: VoiceLink;
  watch: PlaybackWatch;
  idle: IdleLeave;
  downloader: TrackDownloader;
  persistence: SessionPersistence;
  trackSink: SessionPersistence;
  /** 설정 칸(음량 · 반복 · 자동재생 · 멈춤 · 채널)이 바뀌면 알릴 곳. 무엇을 언제 쓸지는 받는 쪽(세션 저장)이 정한다. 복원은 DB 에서 읽은 값이라 알리지 않는다 */
  settingsSink: { onSettingsChanged(): void } | null;
  warmer: QueueWarmer;
  sponsorSkipper: SponsorSkipper;
  _retryTrack?: QueuedTrack | null;
  _autoplayPicking?: boolean;
  /** 자동재생 길 찾기의 바깥 경계. 테스트만 넘긴다 */
  autoplayDeps?: AutoplayDeps;

  constructor(guild: Guild, textChannel: GuildTextBasedChannel | null, voiceChannel: VoiceBasedChannel | null, boundary: Partial<Boundary> = {}) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.io = { ...defaultBoundary, ...boundary };

    // 오디오 플레이어 설정
    this.audioPlayer = this.io.createAudioPlayer({ behaviors: { maxMissedFrames: MAX_MISSED_FRAMES } });
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

    // 세션 관리 - 오래된 버튼 상호작용을 막기 위한 고유 ID
    this.sessionId = createPlayerSessionId();

    // 재생 생명주기 상태
    this._endReason = null;
    this.retry = FRESH;
    this.failedTracks = 0;
    this.lifecycle = new PlaybackState(() => this._trackLabel()); // 재생 단계와 끝 처리 중인가
    this.lastPlaybackPosition = 0; // 재생이 없을 때(복원 직후 등) 알려 줄 위치

    // 일시정지 관리
    this.pauseReasons = new Set();

    // 협력 모듈. 각자 자기 상태와 타이머를 가진다
    this.voice = this.io.createVoice(this);
    this.watch = new PlaybackWatch(this); // 넘침 안전망 · 버퍼링 감시 · 멎음 감시
    this.idle = new IdleLeave(this); // 혼자 남음 · 틀 게 없음 퇴장
    this.downloader = this.io.createDownloader(this);
    this.persistence = this.io.createPersistence(this);
    this.trackSink = this.persistence; // trackState가 바뀐 것을 저장으로 알린다
    this.settingsSink = this.persistence; // 설정이 바뀐 것도
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
    // 오디오 플레이어는 라이브러리가 쏜다. 리스너를 이 서버의 문맥에 묶어 새어 나온 오류가 이 서버로 돌아오게 한다(infra/guildContext)
    const own = <A extends unknown[]>(fn: (...args: A) => void) => bindToGuild(this.guild.id, fn);

    this.audioPlayer.on(
      AudioPlayerStatus.Playing,
      own(() => {
        // pause()는 재생 중일 때만 먹는다. 버퍼링 중에 걸린 일시정지는 재생으로 넘어오는 이 순간에 건다.
        if (this.pauseReasons.size > 0) {
          this.audioPlayer.pause();
          return;
        }
        this.paused = false;
        this._showTrackInVoiceStatus();
      }),
    );

    this.audioPlayer.on(
      AudioPlayerStatus.Paused,
      own(() => {
        this.paused = true;
        this._showTrackInVoiceStatus();
      }),
    );

    this.audioPlayer.on(
      AudioPlayerStatus.Idle,
      own(() => this.onPlayerIdle("idle")),
    );

    // 내장 방어(maxMissedFrames)는 Playing 중에만 돈다. Buffering에서 멈추면 시작 워치독이 깨운다.
    // 전이 자체는 정상 동작이라 debug, 버퍼링이 3초를 넘기면 warn.
    this.audioPlayer.on(
      "stateChange",
      own((oldState: AudioPlayerState, newState: AudioPlayerState) => this._onAudioState(oldState, newState)),
    );

    // 오디오 플레이어의 오류는 재생 스트림(음원) 쪽이다. 음성 연결 쪽은 연결의 오류 · 전이로 온다(voiceLink).
    // 오디오 플레이어는 이것을 알린 뒤 Idle 로 가므로 끝 까닭만 적어 둔다. 곡 끝 처리가 같은 곡을 끊긴 곳에서 다시 연다(_recoverDrop)
    this.audioPlayer.on(
      "error",
      own((error: Error) => {
        log.error(`재생 스트림 오류: ${this._trackLabel()} | ${messageOf(error)}`);
        this._endReason ??= "stream-error";
      }),
    );
  }

  _onAudioState(oldState: AudioPlayerState, newState: AudioPlayerState) {
    if (oldState.status === newState.status) return;
    if (newState.status === AudioPlayerStatus.Idle) this.watch.armIdle();

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
  }

  // ── 음성 연결. 연결 상태와 복구는 voice(VoiceLink)가 가진다 ──

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

  /** 음성 연결이 복구됐다(voiceConnection 이 알린다). 끊긴 위치에서 다시 튼다. 못 틀면 곡을 오류로 끝낸다 */
  async onVoiceRecovered() {
    if (!this.currentTrack) return;
    try {
      await this.play(this.getCurrentTime(), { continued: true });
    } catch (error) {
      log.error("재생 재개 실패:", error);
      await this.onTrackEnd("error");
    }
  }

  // ── 재생. 단계는 startPlayback, 소리를 여는 것은 media/playbackInput ──────

  /**
   * @param seekMs  곡 안의 시작 위치
   * @param o.continued  같은 곡을 이어 튼다(위치 이동 · 끊김 복구 · 세션 복원). 재생 횟수에 세지 않는다
   * @param o.liveReopen  끊긴 라이브를 다시 연다. 라이브가 아니면(방송이 끝나 다시보기가 됐다) 틀지 않고 live-ended,
   *                      열지 못하면 남기거나 알리지 않고 live-reopen-failed 를 돌려준다. 끝 처리(_recoverDrop)가 다음 곡으로 넘긴다
   */
  async play(seekMs = 0, { continued = false, liveReopen = false }: { continued?: boolean; liveReopen?: boolean } = {}): Promise<PlayResult> {
    // 재진입 가드. play()가 셋업(스트림/다운로드) 중일 때 워처의 자동 스킵 seek가
    // 겹쳐 들어오면 비캐시 곡의 재생이 깨진다(버그). starting 동안 워처는 발동을 미룬다.
    this.lifecycle.to("starting");
    try {
      const start = await prepareStart(this, seekMs);
      if (!start.ok) return start;

      // 새 재생. 위치 재개는 직전 재생이 남긴 스트림 정보를 쓴다(같은 곡일 때만)
      this._endReason = null;
      const previous = this.playback;
      // 틀 곡은 prepareStart 가 정했다
      const current = this.currentTrack;
      if (!current) return { ok: false, code: "queue-empty" };
      const pb = (this.playback = new CurrentPlayback(current, { startOffsetMs: start.startMs }));
      this.lastPlaybackPosition = start.startMs;
      const track = pb.track;

      const source = await resolveSource(this, track, start.startMs, previous?.resume);
      const { streamInfo, cacheFile } = source;
      pb.isLive = source.isLive;
      const transport = (pb.transport = transportOf({ file: cacheFile, streamUrl: streamInfo?.url, streamInfo }));
      pb.live = transport.live; // 끝 처리가 재연결 여부를 이걸로 가른다
      // 다시보기를 처음부터 틀지 않는다. 사용자가 넣은 것은 방송이다
      if (endedLive(liveReopen, transport)) return { ok: false, code: "live-ended" };

      const input = await openInput({
        io: this.io,
        transport,
        streamInfo,
        cacheFile,
        startMs: start.startMs,
        meta: { title: track.title, url: track.pageUrl, duration: track.duration },
        download: !cacheFile && transport.cacheable ? this._downloadAlongside(track, streamInfo) : null,
        // 오류는 곡이 바뀐 뒤에 도착할 수 있다. 이 재생의 곡을 붙잡아 두어 엉뚱한 곡의 캐시로 갈아타지 않게 한다
        onStreamLost: (splicer) => this._planCacheSwitch(splicer, track),
        onProgress: () => {
          pb.inputProgressAt = Date.now();
        },
        label: this._trackLabel(track),
      });
      if (!input.resource) throw codedError("stream-failed", "오디오 리소스를 만들지 못했습니다");
      pb.resource = input.resource;
      pb.cacheFile = input.cacheFile;
      pb.input = input.health;

      await commitPlaying(this, pb, source, { continued });
      this.lifecycle.to("playing");
      return { ok: true, track: this.currentTrack };
    } catch (error) {
      return await this._playFailed(error, liveReopen);
    } finally {
      // 틀지 못하고 나왔다(대기열이 비었거나 실패). 실패 처리가 다음 곡을 틀었으면 그쪽 단계가 이미 섰다
      if (this.lifecycle.starting) this.lifecycle.to("idle", "시작 못 함");
    }
  }

  // play() 가 던졌다. 끊긴 라이브를 다시 여는 중이었으면 끝 처리에 맡긴다
  // (방송이 막 끝나면 yt-dlp 가 오류로 답하기도 한다("technical difficulties"). 끝난 것인지 사고인지 가를 수 없어 끝 처리가 남긴다)
  async _playFailed(error: unknown, liveReopen: boolean) {
    if (liveReopen) return { ok: false, code: "live-reopen-failed", error } satisfies PlayResult;
    // 한 줄에는 무엇이 막았는지만. 원문(yt-dlp 의 WARNING 줄 포함)은 조사할 때 본다
    elog.error({ sub: "Player.play", kind: errorKind(error) }, `재생 실패: ${this._trackLabel()} | ${failureReason(error, YouTube.cookiesConfigured())}`);
    elog.debug({ sub: "Player.play" }, `재생 실패 원문: ${YouTube.briefError(error)}`);
    await this.handleError(error, { tell: true });
    return { ok: false, code: "play-failed", error } satisfies PlayResult;
  }

  /**
   * 스트림과 나란히 받는 캐시. 너무 긴 곡은 받지 않고 스트림으로만 튼다(디스크 · 변환 비용).
   * 곡 길이는 아직 스트림 정보로 채우기 전이라 스트림이 알려 준 길이를 먼저 본다
   */
  _downloadAlongside(track: QueuedTrack, streamInfo: { duration?: number | null } | null) {
    const seconds = streamInfo?.duration || track.duration;
    if (tooLongToCache(seconds)) {
      log.debug(`길이 ${Math.round(seconds / 60)}분이라 캐시하지 않고 스트림으로만 틉니다: ${this._trackLabel(track)}`);
      return null;
    }
    return { start: () => this._startBackgroundDownload(), filePath: this.downloader.trackFilePath(track), wait: (file: string) => TrackDownloader.waitFor(file) };
  }

  /** 즉시 재생과 나란히 캐시를 받아 둔다. 기다리지 않으며, 실패해도 재생은 스트림으로 계속된다. */
  _startBackgroundDownload() {
    // currentTrack은 다운로드가 끝나기 전에 바뀔 수 있다. 지금 곡을 붙잡아 둔다
    const trackToDownload = this.currentTrack;
    if (!trackToDownload) return;
    const { title, duration } = trackToDownload;
    this.downloader
      .downloadTrack(trackToDownload)
      .then((file) => {
        log.debug(`백그라운드 캐시 다운로드 끝: ${this._trackLabel(trackToDownload)} → ${file}`);
        if (this.currentTrack !== trackToDownload) return;
        this._learnLength(trackToDownload);
        // 받으면서 제목을 고쳤다(직접 링크의 파일 태그 등). 채널 상태는 재생을 시작할 때만 쓰므로 여기서 고친다
        if (trackToDownload.title !== title) this._showTrackInVoiceStatus();
        // 제목이나 표시 길이(받기 전에 몰랐던 직접 링크 등)가 바뀌었으면 패널도
        if (trackToDownload.title !== title || trackToDownload.duration !== duration) bestEffort(log, playerEvents.refresh(this), "패널 고치기");
      })
      .catch(() => {
        // 까닭은 받기가 남겼다(캐시 다운로드 실패 줄)
        log.debug(`백그라운드 캐시 받기 실패, 재생은 스트림으로 계속합니다: ${this._trackLabel(trackToDownload)}`);
      });
  }

  /** 트는 음원의 길이를 몰랐는데(받기 전의 직접 링크) 받아 두며 쟀으면 이 재생에 적는다. 곡 끝 판정 · 넘침 안전망이 쓴다 */
  _learnLength(track: QueuedTrack) {
    const pb = this.playback;
    const key = audioKeyOf(track.audioUrl);
    if (!pb || pb.track !== track || pb.lengthMs || !key) return;
    const sec = audioCache.lookupByAudioKey(key)?.duration_sec;
    if (sec && sec > 0) pb.lengthMs = sec * 1000;
  }

  /**
   * 스트림이 죽었을 때 캐시 파일로 소리 없이 갈아탄다. 예약했으면 true.
   * 캐시가 아직 없으면 하지 않는다. 스트림이 이어받거나, Idle → play(위치)가 받는다.
   */
  _planCacheSwitch(splicer: Switchable | null, track: QueuedTrack) {
    const giveUp = (why: string) => {
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
      log.warn(`캐시 재생용 ffmpeg를 띄우지 못했습니다: ${messageOf(error)}`);
      return false;
    }

    if (!splicer.planSwitch(decoder.stdout, atMs)) {
      decoder.kill("SIGKILL");
      return false;
    }
    // 갈아타면 곡 끝 판정은 캐시 파일 쪽을 본다. 버린 스트림이 늦게 남기는 표시는 이 재생과 무관하다
    const pb = this.playback;
    const health = new InputHealth("캐시 전환").watch(decoder);
    splicer.once("switched", (ms: number) => {
      if (pb) pb.input = health;
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
    const reason = this._endReason ?? trigger;
    this._endReason = null;
    // 멈춘 쪽의 호출이 끝난 뒤에 처리한다. 멈춤(audioPlayer.stop)은 Idle 을 곧바로 부른다
    setImmediate(() => {
      this.onTrackEnd(reason).catch((error) => log.error("곡 끝 처리 실패:", error));
    });
  }

  /**
   * 지금 곡을 멈추고 그 까닭을 끝 처리(Idle)에 넘긴다. 곡을 멈추는 쪽은 모두 여기를 지난다.
   * 이미 멈추는 중이면 먼저 온 까닭을 지킨다(겹친 까닭은 로그로만). force 가 거짓이면 남은 소리를 흘려보낸 뒤 멈춘다
   */
  _stopWith(reason: string, { force = true }: { force?: boolean } = {}) {
    if (this._endReason && this._endReason !== reason) log.debug(`이미 멈추는 중(원인=${this._endReason}). ${reason} 은 버린다: ${this._trackLabel()}`);
    this._endReason ??= reason;
    this.audioPlayer.stop(force);
  }

  pauseFor(reason: string | null = null) {
    if (reason) {
      if (!this.pauseReasons.has(reason)) {
        log.info(`일시정지: 원인=${reason} | ${this._trackLabel()}`);
      }
      this.pauseReasons.add(reason);
    }
    this.settingsSink?.onSettingsChanged(); // 멈춤 여부는 아래에서 정해진다. 받는 쪽이 잠깐 모았다가 읽는다

    const status = this.audioPlayer.state.status;
    if (status === AudioPlayerStatus.Paused) {
      this.paused = true;
      return true;
    }

    if (status === AudioPlayerStatus.Playing) {
      const paused = this.audioPlayer.pause();
      if (paused) {
        this.paused = true;
        return true;
      }
    }

    // 버퍼링 중이면 의도만 받아 둔다. 재생으로 넘어오는 순간 Playing 리스너가 멈춘다
    if (status === AudioPlayerStatus.Buffering && this.pauseReasons.size > 0) {
      this.paused = true;
      return true;
    }

    return false;
  }

  resumeFor(reason: string | null = null) {
    if (reason) {
      if (this.pauseReasons.has(reason)) {
        log.info(`일시정지 해제: 원인=${reason} | ${this._trackLabel()}`);
      }
      this.pauseReasons.delete(reason);
    }
    this.settingsSink?.onSettingsChanged();

    if (this.pauseReasons.size > 0) {
      return false;
    }

    const status = this.audioPlayer.state.status;
    if (status === AudioPlayerStatus.Paused) {
      const resumed = this.audioPlayer.unpause();
      if (resumed) {
        this.paused = false;
        return true;
      }
      return false;
    }

    if (status === AudioPlayerStatus.Playing || status === AudioPlayerStatus.Buffering) {
      this.paused = false;
      return true;
    }

    return false;
  }

  /**
   * 재생 상태나 저장된 세션 데이터를 건드리지 않고 모든 반복 타이머를 해제.
   * 그렇지 않으면 30초 상태 검사 interval이 플레이어 객체를 영원히 붙잡습니다.
   */
  _stopTimers() {
    this.idle.stop();
    this.warmer.stop();
    this.persistence.stopStateSync();
    this.voice.stop();
    this.watch.stop();
  }

  // 재생 중 트랙의 캐시 퇴거 보호 해제. currentTrack이 이미 null이어도 기억된 키로 해제
  releaseAudioProtection() {
    const key = this._protectedAudioKey || audioKeyOf(this.currentTrack?.audioUrl);
    if (key) audioCache.unprotect(key);
    this._protectedAudioKey = null;
  }

  /**
   * 이 플레이어를 버린다. 모든 정리(정지 · 나가기 · 강제 퇴장 · 채널 사라짐 · 복구 포기 · 비활성 · 복원 실패 · 교체 · 운영자)가 여기를 지난다.
   * 두 번째 부름은 아무것도 하지 않는다. 버린 뒤 등록부가 스스로 뺀다(disposed 알림).
   * @param o.reason  로그에 남길 원인
   * @param o.session  remove: 세션을 지운다 · save: 저장해 남긴다(/join 이 되살린다) · keep: 건드리지 않는다(따로 저장된 세션이 있다)
   * @param o.panel  끝난 패널 모양(ended 의 reason). 없으면 패널을 고치지 않는다
   * @param o.end  곡이 있었으면 끝 줄에 남길 원인(forced-disconnect · inactivity-timeout · leave 등). 기본 stop
   * @param o.stay  음성 채널에는 남는다(곧 다시 붙는다. 서버 하나 다시 켜기). 기본은 나간다
   */
  async dispose({ reason, session, panel, end = "stop", stay = false }: { reason: string; session: "remove" | "save" | "keep"; panel?: "stop" | "leave" | "disconnected"; end?: string; stay?: boolean }) {
    if (this.lifecycle.disposed) return;
    this.lifecycle.to("disposed", reason);
    try {
      bestEffort(log, this.updateVoiceStatus(""), "음성 채널 상태 지우기");
      if (session === "save") await this.persistence.persistState("leave");
      else if (session === "remove") this.persistence?.removeSession();

      this.sponsorSkipper?.stop();
      this.pauseReasons.clear();
      this.paused = false;
      this._stopTimers();
      this.releaseAudioProtection(); // currentTrack 을 읽으므로 비우기 전에
      this._endPlayback(end);
      if (stay) this.voice.release(reason);
      else this.voice.disconnect(reason);
    } catch (error) {
      log.error("정리 중 오류:", error);
    }
    playerEvents.disposed(this, reason);
    // 패널은 정리가 끝난 뒤에. 패널 참조(글자 채널 · 메시지)를 놓기 전에 끝난 모양으로 고친다
    if (panel) await playerEvents.ended(this, panel).catch((error) => log.warn(`끝난 패널 고치기 실패: ${messageOf(error)}`));
    this._dropPanel();
  }

  // 버린 플레이어는 곡 끝 처리(다음 곡 · 재시도)를 하지 않는다. 끝 줄은 여기서 남긴다
  _endPlayback(end: string) {
    const ending = this.currentTrack ? this._trackLabel() : null;
    trackState.reset(this, { history: true });
    this.audioPlayer.removeAllListeners();
    this.audioPlayer.stop(true);
    if (ending) log.info(`트랙 종료: ${ending} | 원인=${end}`);
    try {
      this.playback?.resource?.playStream?.destroy();
    } catch {
      // 스트림이 이미 제거되었을 수 있음
    }
    this.playback = null;
    this.lastPlaybackPosition = 0;
  }

  // 패널 참조를 놓는다. 남은 패널은 ui 가 기록으로 찾아 끝낸다
  _dropPanel() {
    this.nowPlayingMessage = null;
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
  async seek(seekMs: number, reason = "seek") {
    // 라이브에는 실시간밖에 없다. 되감을 자리도, 앞서 갈 자리도 없다.
    if (this.isLive) {
      clog.info(`위치 이동 거부: ${this._trackLabel()} | 라이브 | 원인=${reason}`);
      return { ok: false, code: "live-no-seek" };
    }
    // 출발은 지금 재생 위치다. lastPlaybackPosition 은 이번 재생을 시작한 자리라 재생 중에 안 바뀐다
    const from = Math.round(this.getCurrentTime() / 1000);
    clog.info(`위치 이동: ${this._trackLabel()} | ${from}초 → ${Math.round(seekMs / 1000)}초 | 원인=${reason}`);
    return this.play(seekMs, { continued: true });
  }

  // reason: "skip"(기본) 또는 "jump"(대기열 점프. 한곡 반복 중에도 재시작이 아니라 선택 곡으로 이동)
  skip(reason = "skip") {
    if (this.currentTrack) {
      clog.info(`스킵: ${this._trackLabel()} | 원인=${reason} | 대기열 ${this.queue?.length ?? 0}곡`);
      // 트랙 타이머 정리
      this.watch.stopOverflow();
      this.idle.cancelEmpty();

      this._stopWith(reason);
      return true;
    }
    return false;
  }

  previous() {
    // 틀고 있는 곡이 없으면 멈출 것도 없다. 멈춤이 곡 끝을 부르지 않아 되감은 곡이 대기열에 걸린 채 남는다
    if (!this.currentTrack) return false;
    clog.info(`이전곡: ${this._trackLabel()} | 이전 기록 ${this.previousTracks?.length ?? 0}곡 | 반복=${this.loop || "off"}`);
    // 한곡 반복 중 이전곡 = 현재 곡 재시작. 대기열 반복인데 대기열이 비었으면 고리에 지금 곡뿐이라 같다. 대기열·기록 불변.
    if (this._restartsOnPrevious()) {
      this.watch.stopOverflow();
      this._stopWith("previous");
      return true;
    }

    // 대기열 반복은 대기열이 고리다. 지금 곡 바로 앞은 대기열 맨 끝 곡(기록이 아니다)
    const rewound = this.loop === "queue" ? trackState.rewindRing(this) : this.previousTracks.length > 0 ? trackState.rewind(this) : null;
    if (rewound) {
      // 현재 트랙은 currentTrack으로 남겨 onTrackEnd가 기록하게 한다. 여기서 이전 트랙을
      // 미리 할당하면 "예기치 않게 종료됨" 재시도 로직이 그 곡을 중간부터 재개한다.

      this.watch.stopOverflow();

      this._stopWith("previous");
      return true;
    }
    return false;
  }

  /** 이전 곡이 지금 곡을 처음부터 트는가. 한곡 반복, 또는 대기열 반복인데 대기열이 비었다(고리에 지금 곡뿐) */
  _restartsOnPrevious() {
    return this.loop === "track" || (this.loop === "queue" && this.queue.length === 0);
  }

  setVolume(volume: number) {
    // 조작 로그는 부르는 쪽(usecases/controls)이 잇단 변경을 모아 한 줄로 남긴다
    this.volume = Math.max(0, Math.min(100, volume));
    if (this.resource && this.resource.volume) {
      this.resource.volume.setVolume(this.volume / 100);
    }
    this.settingsSink?.onSettingsChanged();
    return this.volume;
  }

  shuffleQueue() {
    if (this.queue.length > 1) {
      clog.info(`대기열 섞음: ${this.queue.length}곡`);
      trackState.shuffle(this);
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

  setLoop(mode: Loop) {
    // 모드: false, 'track', 'queue'
    // 끝이 없는 것은 반복할 수 없다. 켜려는 요청만 막고 끄는 것은 언제나 통한다.
    if (mode && this.hasLiveTrack()) {
      clog.info(`반복 거부: 라이브가 있어 반복(${mode})을 켜지 않습니다`);
      return this.loop;
    }
    if (this.loop !== mode) clog.info(`반복: ${this.loop || "off"} → ${mode || "off"}`);
    this.loop = mode;
    this.settingsSink?.onSettingsChanged();
    return this.loop;
  }

  /**
   * 자동재생 장르 설정(false면 끔). 진입점들이 `player.autoplay`에 직접 대입하고 있었는데,
   * 그러면 대기열이 저절로 늘어난 이유를 로그에서 찾을 수 없다. 곡이 붙는 것만 보이고
   * 누가 켰는지가 없다. 반복·볼륨과 같은 조작이므로 같은 자리에 둔다.
   */
  setAutoplay(genre: string | false | null | undefined) {
    const next = genre || false;
    const changed = this.autoplay !== next;
    if (changed) clog.info(`자동재생: ${this.autoplay || "off"} → ${next || "off"}`);
    this.autoplay = next;

    // 미리 뽑아 둔 곡은 껐으면 남을 이유가 없고, 장르를 바꿨으면 이전 장르의 곡이다.
    // 사용자가 넣은 곡은 건드리지 않는다.
    if (changed) {
      const dropped = trackState.dropAutoplay(this);
      if (dropped > 0) clog.info(`미리 뽑아 둔 자동재생 곡 ${dropped}곡을 대기열에서 뺐습니다`);
      if (next) bestEffort(log, this.ensureAutoplayNext(), "자동재생 곡 미리 뽑기");
    }
    this.settingsSink?.onSettingsChanged();
    return this.autoplay;
  }

  clearQueue() {
    const cleared = this.queue.length;
    if (cleared) clog.info(`대기열 비움: ${cleared}곡`);
    trackState.clearQueue(this);
    return cleared;
  }

  removeFromQueue(index: number) {
    const removed = trackState.removeAt(this, index);
    if (removed) {
      clog.info(`대기열 제거: [${index}] "${removed?.title ?? "?"}" | 남은 ${this.queue.length}곡`);
      return removed;
    }
    return null;
  }

  moveInQueue(from: number, to: number) {
    const track = trackState.move(this, from, to);
    if (track) {
      clog.info(`대기열 이동: "${track?.title ?? "?"}" ${from}번 → ${to}번`);
      return true;
    }
    return false;
  }

  /** 곡 안의 지금 위치(ms). 리소스가 실제로 낸 양이라 멈춤 · 버퍼링은 세지 않는다 */
  getCurrentTime() {
    const pb = this.playback;
    if (!pb) return this.lastPlaybackPosition || 0;
    return (pb.startOffsetMs || 0) + (pb.resource?.playbackDuration || 0);
  }

  // 곡 끝 처리. 다시 틀기 · 한곡 반복 · 다음 곡 · 자동재생 · 대기열 소진을 가른다
  async onTrackEnd(reason = "idle") {
    if (!this.lifecycle.beginEnd()) return; // 끝이 겹쳐 들어왔다. 먼저 온 것이 처리한다
    if (this.lifecycle.phase === "playing") this.lifecycle.to("idle", `곡 끝(${reason})`);
    this.sponsorSkipper?.stop(); // 다음 트랙 play()가 onPlayStart로 다시 가동

    try {
      this.watch.stopOverflow();

      const finishedTrack = this.currentTrack;
      this.releaseAudioProtection();
      // 소리를 낸 곡이 끝났으면 연달아 실패한 것이 아니다
      if ((this.playback?.resource?.playbackDuration ?? 0) >= PROGRESS_MS) this.failedTracks = 0;
      const end = this._describeEnd(finishedTrack, reason);
      // 멎어서 넘기는 곡도 실패로 센다. 멎음 감시가 대기열을 10초마다 한 곡씩 버리지 않게
      if (reason === "stuck" && this._countFailure()) return await this._stopAfterFailures();
      if (await this._recoverDrop(finishedTrack, end)) return;

      if (!finishedTrack) {
        this.playback = null;
        return;
      }
      if (await this._playNext(finishedTrack, reason)) return;
      await this.finishQueue();
    } finally {
      this.lifecycle.finishEnd();
      this._endReason = null;
    }
  }

  // 어떻게 끝났는지 재고 로그로 남긴다
  _describeEnd(finishedTrack: QueuedTrack | null, reason: string): EndShape {
    const playedMs = this.getCurrentTime();
    this.lastPlaybackPosition = playedMs;
    const label = this._trackLabel(finishedTrack);
    log.info(`트랙 종료: ${label} | 원인=${reason}`);
    if (!finishedTrack) return { playedMs, label, dropped: false, live: false, why: "곡 없음" };

    const facts = endFactsOf(this.playback, reason, playedMs);
    const { dropped, why } = endVerdict(facts);
    const lengthText = facts.lengthMs ? `${sec(facts.lengthMs)}초` : "모름";
    wlog.debug(`트랙 종료 판정: ${dropped ? "끊김" : "끝"}(${why}) | 재생 ${sec(playedMs)}초 / 길이 ${lengthText}`);
    if (reason === "idle" && !facts.streamEnded && !facts.live) log.warn(`공급이 끊겨 플레이어가 멈춤: ${label} | ${starvedDetail(this.playback)}`);
    // 길이는 판정에 쓰지 않는다. 저절로 끝난 위치가 길이와 크게 다르면 길이 쪽을 살필 수 있게 남긴다
    if (!dropped && reason === "idle" && facts.lengthMs && Math.abs(playedMs - facts.lengthMs) > LENGTH_MISMATCH_LOG_MS) {
      log.info(`곡이 길이와 다른 위치에서 끝남: ${label} | 재생 ${sec(playedMs)}초 / 길이 ${lengthText}`);
    }
    return { playedMs, label, dropped, live: dropped && facts.live, why };
  }

  // 사고로 끊겼으면 다시 튼다. 다시 틀었거나 연달아 실패해 멈췄으면 true, 다음 곡으로 넘길 것이면 false
  async _recoverDrop(finishedTrack: QueuedTrack | null, { playedMs, label, dropped, live, why }: EndShape) {
    if (!dropped) {
      this.retry = FRESH;
      return false;
    }
    // 곡이 바뀌는 경로가 여기만이 아니라서, 포기할 때 비우는 대신 곡으로 가른다
    if (this._retryTrack !== finishedTrack) {
      this._retryTrack = finishedTrack;
      this.retry = FRESH;
    }
    const step = countDrop(this.retry, this.playback?.resource?.playbackDuration ?? 0, live);
    this.retry = step.state;
    const tries = `${step.state.used}/${live ? MAX_LIVE_REOPENS : MAX_TRACK_RETRIES}`;
    const at = `${sec(playedMs)}초`;
    if (step.reopen && live) {
      log.warn({ tags: ["retry"] }, `라이브 연결이 끊겨 다시 엽니다: ${label} | ${why} (${tries})`);
      // 주소에는 수명이 있고, 만료된 주소로는 몇 번을 다시 붙어도 실패한다.
      // 위치 0으로 트는 것이 곧 "yt-dlp로 주소를 새로 받는다"이고, 라이브는 애초에 엣지로만 붙는다.
      await new Promise((done) => setTimeout(done, LIVE_REOPEN_DELAY_MS * step.state.used));
      return this._reopenLive(label);
    }
    if (step.reopen) {
      log.warn({ tags: ["retry"] }, `재생이 끊겨 ${at} 지점부터 다시 재생합니다: ${label} | ${why} (${tries})`);
      const started = Date.now();
      const reopened = await this.play(playedMs, { continued: true });
      if (reopened.ok) log.info({ tags: ["retry"] }, `다시 열었습니다: ${label} | ${sec(Date.now() - started)}초 걸림`);
      return true;
    }
    const stopping = this._countFailure();
    const detail = `${live ? "" : `${at} 지점, `}${step.why}`;
    const what = live ? "라이브를 다시 열지 못해" : "재생을 복구하지 못해";
    log.error(`${what} ${stopping ? "곡을 끝냅니다" : "다음 곡으로 넘깁니다"}: ${label} | ${detail}`);
    if (!stopping) return false;
    await this._stopAfterFailures();
    return true;
  }

  // 끊긴 라이브를 다시 연다. 열었으면 true. 방송이 끝났거나 열지 못했으면 실패로 세지 않고 알리지 않는다.
  // false 면 끝 처리가 다 튼 곡처럼 기록에 넣고 다음 곡으로 넘긴다
  async _reopenLive(label: string) {
    const reopened = await this.play(0, { liveReopen: true });
    if (reopened.ok) return true;
    if (reopened.code === "live-ended") log.info(`방송이 끝나 다음 곡으로 넘깁니다: ${label} | 다시 열어 보니 라이브가 아님`);
    else if (reopened.error) log.warn({ kind: errorKind(reopened.error) }, `라이브를 다시 열지 못해 다음 곡으로 넘깁니다: ${label} | ${failureReason(reopened.error, YouTube.cookiesConfigured())}`);
    else log.warn(`라이브를 다시 열지 못해 다음 곡으로 넘깁니다: ${label} | ${reopened.code}`);
    return false;
  }

  // 곡 하나가 실패했다. 연달아 한도에 닿았으면 true(부르는 쪽이 _stopAfterFailures 로 멈춘다)
  _countFailure() {
    this.failedTracks += 1;
    return this.failedTracks >= FAILED_TRACKS_LIMIT;
  }

  /**
   * 곡이 연달아 실패했다. 다음 곡으로 넘기기를 그만두고 멈춘다. 네트워크가 끊겼을 때 대기열을 통째로 버리지 않게.
   * 실패한 곡만 내리고 대기열은 둔다. 곡을 추가하면 그 곡부터 다시 튼다
   */
  async _stopAfterFailures() {
    const count = this.failedTracks;
    this.failedTracks = 0; // 사용자가 다시 틀 때 한 번 실패로 곧바로 멈추지 않게
    log.error(`곡 ${count}개가 연달아 실패해 재생을 멈춥니다: ${this._trackLabel()}${this.queue.length ? ` | 대기열 ${this.queue.length}곡은 둡니다` : ""}`);
    trackState.setCurrent(this, null);
    this.playback = null;
    this.lastPlaybackPosition = 0;
    try {
      this.audioPlayer.stop(true);
    } catch {
      /* 이미 멈춘 플레이어다 */
    }
    // 세션을 되살리는 /join 은 이것을 명령 응답으로 말한다(quietFailures)
    if (!this.quietFailures) await playerEvents.notice(this, "failed-in-row", { count, left: this.queue.length }).catch(noticeFailed);
    // 남은 곡이 없으면 보통의 대기열 소진과 같다(세션을 지우고, 나갈 시각을 보이고, 나간다). 곡 담기가 첫 곡을 트는 중이면 담기가 끝낸다
    if (this.queue.length === 0) return this.finishByCaller ? undefined : this.finishQueue();
    bestEffort(log, this.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
    // 남은 곡이 있으니 나가지 않는다. 틀 게 없음 퇴장을 걸지 않는다(혼자 남음 퇴장은 그대로 돈다)
    await playerEvents.ended(this, "failures");
  }

  // 한곡 반복 · 다음 곡 · 자동재생 중 하나를 튼다. 틀었으면 true
  async _playNext(finishedTrack: QueuedTrack, reason: string) {
    // 멎어서 넘기는 곡(stuck)은 한곡 반복이어도 되풀이하지 않는다
    const restart = this.loop === "track" ? !["stop", "jump", "stuck"].includes(reason) : reason === "previous" && this._restartsOnPrevious();
    if (restart) {
      // 한곡 반복: 자연 종료·스킵·이전곡 모두 현재 곡을 처음부터 다시 재생. 대기열 반복인데 대기열이 비었을 때의 이전곡도 같다
      // 대기열·이전 곡 기록은 불변. 다음 곡으로 넘어가려면 반복 해제 또는 대기열 점프(jump).
      await this.play(0);
      return true;
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
      return true;
    }
    return this.autoplay ? this._continueAutoplay(this.autoplay) : false;
  }

  // 대기열이 비어 자동재생으로 잇는다. 틀었으면 true
  async _continueAutoplay(genre: string) {
    const { genres } = genreConfig.genres();
    if (!genres[genre]) {
      // 알 수 없는 장르(장르 목록 변경 전에 저장된 세션 등). 끄고 알린 뒤 일반 대기열 종료 흐름으로
      log.warn(`자동재생을 종료합니다. 알 수 없는 장르: ${genre}`);
      playerEvents.notice(this, "autoplay-unknown-genre", { genre }).catch(noticeFailed);
      this.setAutoplay(false);
      return false;
    }
    this.retry = FRESH;
    // 못 골랐으면 false 로 대기열 소진 흐름으로 떨어진다.
    // 그냥 끝내면 현재곡이 끝난 곡을 가리킨 채 남아 곡 추가·스킵이 전부 먹통이 된다.
    // 이때 자동재생은 켜 둔 채로 둔다. 후보를 한 번 못 찾은 것이 장르를 끌 이유는 아니다.
    return this.handleAutoplay();
  }

  // 다 끝났다. 다음 재생은 새로 시작하는 것이라 이전 곡 기록도 비운다
  async finishQueue() {
    trackState.reset(this, { history: true });

    bestEffort(log, this.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");

    await playerEvents.ended(this, "queue-end");

    this.idle.cancelAlone(false);
    this.persistence?.removeSession();

    this.idle.scheduleEmpty();
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

      // 길 찾기는 바깥 경계(pickAutoplay)를 지난다. autoplayDeps: 그 안의 소스 · 검색 · 장부 · AI 보조. 테스트만 넘긴다. 없으면 진짜
      const picked = await this.io.pickAutoplay(cfg, recent, this.autoplayDeps);
      if (!picked) {
        log.warn(`자동재생: 어느 소스에서도 곡을 찾지 못했습니다 (장르 ${this.autoplay})`);
        return null;
      }

      picked.requestedBy = this.guild.members.me?.user;
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
      log.error("자동재생 오류:", messageOf(error));
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
    else await playerEvents.started(this);
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
          await this.io.sleep(config.preload.gapMs);
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

      if (added) await bestEffort(log, playerEvents.refresh(this), "패널 고치기");
      return added > 0;
    } finally {
      this._autoplayPicking = false;
    }
  }

  // 지금 장르의 자동재생 설정. 기준값 위에 장르 설정을 얹는다. 모르는 장르면 null.
  _autoplayConfig() {
    const { defaults, genres } = genreConfig.genres();
    const name = this.autoplay;
    const genre = name ? genres[name] : undefined;
    // 이름도 같이 넘긴다. AI 보조가 "이 장르가 맞나"를 물을 때 쓴다(autoplay/assist)
    return name && genre ? { ...defaults, ...genre, genreName: name } : null;
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
  async handleError(error: unknown, { tell = false }: { tell?: boolean } = {}) {
    // 내려간 영상을 고른 자동재생 곡. 우리가 고른 것이니 사용자에게 알릴 일이 아니다.
    // 기억해 두고(다음에 또 고르지 않게) 조용히 다른 곡으로 넘어간다.
    const failed = this.currentTrack;
    if (failed?.autoplay && YouTube.isVideoUnavailableError(error)) {
      autoplayRoute.markDead(failed);
      log.info(`자동재생 곡을 건너뜁니다(영상 없음): "${failed.title}"`);
      tell = false;
    }
    // 다음 곡이 또 실패하면 여기로 다시 온다. 연달아 실패하면 대기열을 다 버리기 전에 멈춘다(자동재생이 죽은 곡을 계속 고를 때도)
    if (this._countFailure()) return this._stopAfterFailures();

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
      // 마지막 곡 실패 정리: 오디오플레이어를 정지해 '말하는 중'(speaking) 상태·유령 재생을 해제.
      // 사용자 알림은 호출자(명령 editReply / 대시보드 응답)가 play() 반환값으로 처리한다. 여기서 글자 채널로 또 보내지 않는다.
      try {
        this.audioPlayer.stop(true);
      } catch {
        /* 이미 멈춘 플레이어다 */
      }
      // 틀 곡이 없다. 다 튼 것과 같이 끝낸다(끝난 패널 · 세션 지움 · 나갈 예약). 곡 담기가 첫 곡을 트는 중이면 담기가 끝낸다
      if (!this.finishByCaller) await this.finishQueue();
    }
  }

  // ── 세션 영속화. 로직은 SessionPersistence ────────────────────────────────

  /** 쓸 채널을 정한다. 준 것만 바꾸고 null 은 덮지 않는다(대시보드처럼 글자 채널이 없는 입구가 지우지 않게) */
  bindChannels({ voice = null, text = null }: { voice?: VoiceBasedChannel | null; text?: GuildTextBasedChannel | null }) {
    if (voice) this.voiceChannel = voice;
    if (text) this.textChannel = text;
    this.settingsSink?.onSettingsChanged();
  }

  /** 패널을 다른 글자 채널로 옮긴다. 옛 패널 참조를 놓는다(옛 패널은 새로 올릴 때 기록을 보고 치운다) */
  movePanel(channel: GuildTextBasedChannel) {
    this.nowPlayingMessage = null;
    this.nowPlayingWebhook = null;
    this.textChannel = channel;
    this.settingsSink?.onSettingsChanged();
  }

  /** 저장된 설정을 되돌린다(세션 복원). 멈춤 사유는 비운다. 복원한 뒤의 상황(혼자 남음 등)이 다시 건다 */
  restoreSettings({ volume, loop, autoplay }: { volume?: number | null; loop: Loop; autoplay: string | false }) {
    this.pauseReasons = new Set();
    if (typeof volume === "number") this.volume = volume;
    this.loop = loop;
    this.autoplay = autoplay;
  }

  /** 지금 곡을 음성 채널 상태에. 일시정지면 그 앞머리로 */
  _showTrackInVoiceStatus() {
    if (!this.currentTrack) return;
    const { playingPrefix, pausedPrefix } = config.voiceStatus;
    bestEffort(log, this.updateVoiceStatus(`${this.paused ? pausedPrefix : playingPrefix}${this.currentTrack.title}`), "음성 채널 상태 바꾸기");
  }

  /** 봇이 다른 음성 채널로 옮겨졌다. 옛 채널에 우리가 쓴 상태를 지우고(사람이 남아 있으면 디스코드가 지우지 않는다) 새 채널에 지금 상태를 쓴다 */
  movedVoiceStatus(fromId: string) {
    bestEffort(log, this.updateVoiceStatus("", fromId), "옛 음성 채널 상태 지우기");
    if (this.currentTrack) this._showTrackInVoiceStatus();
    else bestEffort(log, this.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
  }

  // 실패는 던진다. 부르는 쪽이 모두 bestEffort 로 받아 남긴다. channelId 를 주지 않으면 지금 음성 채널
  async updateVoiceStatus(status: string | null, channelId = this.voiceChannel?.id) {
    const channel = channelId ? this.guild.channels.cache.get(channelId) : null;
    if (!channel) return;

    const me = this.guild.members.me;
    if (!me) return;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SetVoiceChannelStatus)) return;

    // 사람이 적어 둔 상태는 건드리지 않는다. 현재 값은 게이트웨이로만 알 수 있다(voiceChannelStatus).
    if (!voiceChannelStatus.canWrite(channel.id)) return;

    await this.guild.client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: status ?? "" } });
    voiceChannelStatus.mark(channel.id, status ?? "");
  }

  /** 이 뒤로 만드는 플레이어의 바깥 경계 기본값. 테스트만 쓴다. 인자 없이 부르면 진짜로 돌아간다 */
  static useBoundary(overrides?: Partial<Boundary>) {
    defaultBoundary = overrides ? { ...REAL, ...overrides } : REAL;
  }
}

export type { Boundary, PanelMessage, PanelHook };
export { Player };
