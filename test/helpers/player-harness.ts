// 진짜 Player 를 세워 play() 를 끝까지 돌리는 하네스.
//
// 다른 테스트는 가짜 객체에 메서드를 빌려 붙여 조각을 테스트한다. 그래서 생성자와 협력자가 다 얽힌
// play() 는 한 번도 돌지 않았다. 여기서는 플레이어를 진짜로 만들고, 바깥과 닿는 곳만 교체한다.
//
//   음성 라이브러리 · ffmpeg · 청크 스트림 · HTTP · 직접 링크 · 스트림 주소
//                                          플레이어의 바깥 경계로 넘긴다(Player.useBoundary). 명령 · 곡 추가가
//                                          만드는 플레이어도 같은 가짜를 쓴다
//   캐시 DB                                진짜 audioCache 를 임시 DB 로. "캐시 DB 에 무엇을 적었나"를 그대로 본다
//   다운로드 · SponsorBlock · 동등물        테스트마다 behavior 에 적은 것으로 답한다(바깥 경계로 넘긴다)
//   음성 연결 · 세션 저장 · 예열            연결은 붙은 것으로, 저장은 부른 것만 기록한다
//
// node --test 는 테스트 파일마다 프로세스를 따로 실행하므로 여기서 바꾼 것이 다른 테스트 파일로 새지 않는다.

import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { PassThrough, Writable, type Readable } from "stream";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";
import type { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import type { Guild, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { Boundary } from "../../src/player/player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import type { DownloadTrack } from "../../src/media/cache-download.ts";
import type { ChunkedOptions } from "../../src/media/chunked-stream.ts";
import type { SeekRequest, SeekAnswer } from "../../src/media/seek-start.ts";
import { startOf, type FragmentOptions } from "../../src/media/fragment-stream.ts";
import type { StreamInfo } from "../../src/sources/stream-url.ts";
import type { Segments } from "../../src/sources/sponsor-block.ts";
import type { RestoredSession } from "../../src/store/player-sessions.ts";
import type { AudioRow } from "../../src/store/audio-cache.ts";
import type { LookupRow } from "../../src/store/rows.ts";

// 가짜 ffmpeg 프로세스와 오디오 리소스. 테스트가 읽는 필드
type FakeChild = EventEmitter & { args: string[]; label: string; stdout: PassThrough; stderr: PassThrough; stdin: Writable; exitCode: number | null; signalCode: string | null; killed: boolean; kill(): boolean };
type FakeResource = {
  input: Readable;
  options: { metadata?: unknown };
  metadata: unknown;
  playbackDuration: number;
  volume: { value: number | null; setVolume(v: number): void };
  encoder: { bitrate: number | null; setBitrate(b: number): void };
  playStream: { destroy(): void };
};

// 재생 입력이 fetch 에 넘기는 필드
type FetchInit = { headers: Record<string, string> };

// 판정 테스트에서 무엇이 불렸는지 모은다. 테스트마다 reset() 으로 비운다
const calls = {
  spawns: [] as FakeChild[],
  resources: [] as FakeResource[],
  chunked: [] as ChunkedOptions[],
  seeks: [] as SeekRequest[], // 색인으로 받기 시작할 자리를 물은 요청
  chunkedStreams: [] as Array<PassThrough & { received: number; resuming: boolean }>, // 청크 스트림 가짜. 받은 양 · 이어받는 중인가는 테스트가 정한다
  fragments: [] as FragmentOptions[], // 조각 스트림을 연 요청
  fetches: [] as Array<{ url: string; init: FetchInit }>,
  downloads: [] as DownloadTrack[],
  persists: [] as string[],
  settings: 0, // 플레이어가 설정이 바뀌었다고 알린 횟수
  directStreams: [] as string[],
  sink: [] as string[],
  steps: [] as string[],
  sent: [] as unknown[], // 텍스트 채널에 보낸 것
  recoveries: [] as string[], // 연결 복구를 시작한 것
};

// ── 1. 음성 라이브러리 ──────────────────────────────────────────────────
import { AudioPlayerStatus } from "@discordjs/voice";
import { cacheDb } from "../../src/store/cache-db.ts";
import * as stores from "../../src/store/stores.ts";

class FakeAudioPlayer extends EventEmitter {
  state: { status: AudioPlayerStatus; resource?: unknown };
  played: unknown[];
  stops: number;

  constructor() {
    super();
    this.state = { status: AudioPlayerStatus.Idle };
    this.played = [];
    this.stops = 0;
  }
  play(resource: unknown) {
    this.played.push(resource);
    this.state = { status: AudioPlayerStatus.Buffering, resource };
  }
  pause() {
    if (this.state.status !== AudioPlayerStatus.Playing) return false;
    this.state = { ...this.state, status: AudioPlayerStatus.Paused };
    return true;
  }
  unpause() {
    if (this.state.status !== AudioPlayerStatus.Paused) return false;
    this.state = { ...this.state, status: AudioPlayerStatus.Playing };
    return true;
  }
  stop() {
    this.stops += 1;
    this.state = { status: AudioPlayerStatus.Idle };
    return true;
  }
}

function createAudioResource(input: Readable, options: { metadata?: unknown } = {}): FakeResource {
  const resource: FakeResource = {
    input,
    options,
    metadata: options.metadata,
    playbackDuration: 0,
    volume: {
      value: null,
      setVolume(v: number) {
        this.value = v;
      },
    },
    encoder: {
      bitrate: null,
      setBitrate(b: number) {
        this.bitrate = b;
      },
    },
    playStream: { destroy() {} },
  };
  calls.resources.push(resource);
  return resource;
}

// ── 2. ffmpeg ─────────────────────────────────────────────────────────
function fakeChild(args: string[], label: string): FakeChild {
  const child: FakeChild = Object.assign(new EventEmitter(), {
    args,
    label,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new Writable({ write: (_c, _e, done) => done() }),
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: () => {
      child.killed = true;
      return true;
    },
  });
  return child;
}
function spawnFfmpeg(args: string[], label: string) {
  const child = fakeChild(args, label);
  calls.spawns.push(child);
  return child;
}
const caps = { ok: true, https: true, hls: true, dash: true, segMaxRetry: true };

// ── 3. 청크 스트림 ─────────────────────────────────────────────────────
async function openChunkedStream(opts: ChunkedOptions) {
  calls.chunked.push(opts);
  if (behavior.chunked) await behavior.chunked(opts);
  const stream = Object.assign(new PassThrough(), {
    received: 0,
    resuming: false,
    stats: () => ({ requests: 1, received: stream.received, totalBytes: opts.totalBytes, idleMs: 0, expiresInS: null, resuming: stream.resuming }),
  });
  calls.chunkedStreams.push(stream);
  return stream;
}

// 색인 묻기 가짜. 기본은 없음이라 청크 스트림은 처음부터 받는다
async function seekStart(request: SeekRequest): Promise<SeekAnswer> {
  calls.seeks.push(request);
  return behavior.seekStart ? behavior.seekStart(request) : { ok: false, why: "시험", near: true };
}

// 조각 스트림 가짜. 진짜처럼 위치가 든 조각의 시작부터 흘린다고 알린다
function openFragmentStream(opts: FragmentOptions) {
  calls.fragments.push(opts);
  const { atMs } = startOf(opts.fragments, opts.durationMs, opts.startMs);
  return Object.assign(new PassThrough(), { startedAtMs: atMs, describe: () => "조각 가짜" });
}

// ── 4. 캐시 DB: 진짜를 임시 DB 로 ──────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "player-harness-"));
const audioCache = await import("../../src/store/audio-cache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();

// 설정. 캐시 길이 상한은 테스트마다 기본값으로 되돌린다(reset)
const config = (await import("../../src/config/index.ts")).default;
const DEFAULT_MAX_TRACK_SEC = 60 * 60;

// ── 5. Player 와 협력자를 불러 바깥 경계에 가짜를 넘긴다 ────────────────
const Player = (await import("../../src/player/player.ts")).Player;
type Player = InstanceType<typeof Player>;
const { TrackDownloader } = await import("../../src/media/cache-download.ts");
const SponsorBlock = await import("../../src/sources/sponsor-block.ts");
const VoiceLink = (await import("../../src/player/voice-link.ts")).VoiceLink;
const SessionPersistence = (await import("../../src/player/session-mirror.ts")).SessionPersistence;
const QueueWarmer = (await import("../../src/player/queue-warmer.ts")).QueueWarmer;
const { PlayerRegistry } = await import("../../src/player/registry.ts");
// 직접 링크 곡의 파일 태그 · 그림 찾기는 원본을 열지 않는다(시험은 네트워크로 나가지 않는다). 찾기를 보는 시험은 embedded-art 시험이 따로
(await import("../../src/sources/embedded-art.ts"))._internals.useOpen(async () => {
  throw new Error("시험에서는 원본을 열지 않는다");
});
const playerEvents = await import("../../src/player/events.ts");
// 운영처럼 버려진 플레이어는 레지스트리가 뺀다(그 서버에 이 플레이어가 아직 있을 때만). 서버마다 레지스트리가 따로라 알림은 여기서 한 번만 듣는다
playerEvents.on("disposed", (player) => registryOf(player)?.forget(player));

// 협력 모듈 가짜. 플레이어의 바깥 경계(createVoice · createPersistence · createWarmer)로 넘긴다
// 붙은 것으로 둔 연결. 테스트는 emit 으로 상태를 흉내 낸다
// 부순 방식(leave: 나감 메시지 · stay: 채널에 남음)을 destroyed 에 적는다
const fakeConnection = () =>
  Object.assign(new EventEmitter(), {
    state: { status: "ready" },
    destroyed: [] as string[],
    destroy(adapterAvailable = true) {
      this.destroyed.push(adapterAvailable ? "leave" : "stay");
    },
    subscribe() {},
  }) as unknown as VoiceConnection & { destroyed: string[] };
class FakeVoice extends VoiceLink {
  recover(why: string) {
    calls.recoveries.push(why);
  }
  async connect() {
    await behavior.connect?.();
    this.player.connection = fakeConnection();
    this.state = "ready";
    return true;
  }
}

// 대기열이 바뀔 때 세션 저장이 받는 알림(on…)은 어떤 알림이 어떤 순서로 가는지만 남긴다
class FakePersistence extends SessionPersistence {
  _mirror() {}
  async persistState(reason: string) {
    calls.persists.push(reason);
  }
  startStateSync() {}
  stopStateSync() {}
  // 잠깐 모았다가 쓰는 것은 세션 저장 테스트가 본다. 여기서는 알림만 센다
  onSettingsChanged() {
    calls.settings++;
  }
  removeSession() {
    calls.persists.push("remove");
  }
  // 테스트가 복원을 정했으면 그것으로(결과는 복원한 뒤의 상태로 구분한다). 아니면 진짜
  async restoreFromState(record: RestoredSession | null | undefined, options?: { announce?: boolean }) {
    if (behavior.restore) {
      await behavior.restore.call(this.player, record, options);
      return this.player.currentTrack ? "restored" : this.player.queue.length ? "failed" : "empty";
    }
    return super.restoreFromState(record, options);
  }
  onSetCurrent() {
    calls.sink.push("onSetCurrent");
  }
  onEnqueue() {
    calls.sink.push("onEnqueue");
  }
  onTake() {
    calls.sink.push("onTake");
  }
  onRetire() {
    calls.sink.push("onRetire");
  }
  onRewind() {
    calls.sink.push("onRewind");
  }
  onRemoveAt() {
    calls.sink.push("onRemoveAt");
  }
  onMove() {
    calls.sink.push("onMove");
  }
  onClearQueue() {
    calls.sink.push("onClearQueue");
  }
  onReset() {
    calls.sink.push("onReset");
  }
  onReplace() {
    calls.sink.push("onReplace");
  }
}

class FakeWarmer extends QueueWarmer {
  start() {}
}

// 테스트마다 바꾸는 협력자. 기본값은 "아무 일도 안 일어남"
type Behavior = {
  stream: ((track: QueuedTrack) => StreamInfo | Promise<StreamInfo>) | null;
  equivalent: ((track: QueuedTrack) => string | null) | null;
  sponsor: ((track: QueuedTrack) => Segments | null | Promise<Segments | null>) | null;
  download: ((track: DownloadTrack) => string | Promise<string>) | null;
  fetch: ((url: string, init: FetchInit) => unknown) | null;
  chunked: ((opts: ChunkedOptions) => unknown) | null;
  seekStart: ((request: SeekRequest) => SeekAnswer | Promise<SeekAnswer>) | null;
  directStream: ((url: string, opts?: { startMs?: number; liveOnly?: boolean }) => Readable | Promise<Readable>) | null;
  restore: ((this: Player, record: RestoredSession | null | undefined, options?: { announce?: boolean }) => unknown) | null;
  autoplay: (() => QueuedTrack | null) | null;
  connect: (() => unknown) | null;
};
const behavior: Behavior = {
  stream: null, // (track) → streamInfo. 던지면 스트림 실패
  equivalent: null, // (track) → youtubeUrl. 스포티파이 동등물
  sponsor: null, // (track) → SponsorBlock.forTrack 의 답
  download: null, // (track) → Promise<file>. 기본은 끝나지 않는 약속
  fetch: null, // (url, init) → Response 비슷한 것
  chunked: null, // (opts) → 던지면 청크 스트림의 첫 요청 실패
  seekStart: null, // (request) → 색인의 답. 기본은 없음(처음부터 받는다)
  directStream: null, // (url) → Readable
  restore: null, // function (record) — this 는 플레이어. 세션 복원(명령 · 곡 추가의 분기)
  autoplay: null, // () → 자동재생이 선택할 곡. 기본은 못 찾음
  connect: null, // () → 던지면 음성 채널에 붙지 못함
};

// 동등물 찾기 가짜. 찾으면 진짜처럼 트랙에 음원 주소를 적는다
const findEquivalent = async (track: QueuedTrack) => {
  calls.steps.push("equivalent");
  const url = behavior.equivalent ? behavior.equivalent(track) : null;
  if (url) {
    track.audioUrl = url;
  }
  return url;
};
// 진짜처럼 영상 id 를 알 때만 답한다(스포티파이는 동등물을 찾은 뒤)
const sponsorFor = async (track: QueuedTrack) => {
  calls.steps.push("sponsor");
  if (!SponsorBlock._trackVideoId(track)) return null;
  return behavior.sponsor ? behavior.sponsor(track) : null;
};
// 진짜 다운로드는 첫 await 전에 두 가지를 동기로 한다. 캐시 파일 기록에 "다운로드 중" 행을 만들고(recordDownloadStart),
// 다운로드 중 목록에 올린다. play() 끝의 링크 데이터 기록이 그 행에 기대므로(외래 키) 가짜도 똑같이 해야 한다.
// 다운로드 중 목록은 진짜 것을 쓴다. 그래야 다운로드 중인 파일을 캐시로 치지 않는 판정(findCacheFile)이 그대로 돈다
const { inFlight } = TrackDownloader._internals;
class FakeDownloader extends TrackDownloader {
  downloadTrack(track: DownloadTrack) {
    calls.downloads.push(track);
    const key = audioKeyOf(track.audioUrl);
    if (key) audioCache.recordDownloadStart(key, track);
    const filepath = this.trackFilePath(track);
    const download = behavior.download;
    const running: Promise<string> = download ? Promise.resolve().then(() => download(track)) : new Promise(() => {});
    inFlight.set(filepath, running);
    running.then(
      () => inFlight.delete(filepath),
      () => inFlight.delete(filepath),
    );
    return running;
  }
}
// 플레이어의 바깥 경계. 이 뒤로 만드는 플레이어가 모두 쓴다
// 음성 라이브러리 · ffmpeg · 청크 스트림 · HTTP 가짜는 여기서 한 번씩 진짜 타입으로 본다(테스트가 읽는 필드만 흉내 낸다)
const fakes: Partial<Boundary> = {
  createAudioPlayer: () => new FakeAudioPlayer() as unknown as AudioPlayer,
  createVoice: (player) => new FakeVoice(player),
  createPersistence: (player) => new FakePersistence(player),
  createWarmer: (player, deps) => new FakeWarmer(player, deps),
  createDownloader: (player) => new FakeDownloader(player),
  findEquivalent,
  sponsorFor,
  // 자동재생 길 찾기. 기본은 "못 찾음"(밖으로 나가지 않는다)
  pickAutoplay: async () => (behavior.autoplay ? behavior.autoplay() : null) as Awaited<ReturnType<Boundary["pickAutoplay"]>>,
  createAudioResource: createAudioResource as unknown as Boundary["createAudioResource"],
  spawnFfmpeg: spawnFfmpeg as unknown as Boundary["spawnFfmpeg"],
  ffmpegCapabilities: () => caps,
  openChunkedStream: openChunkedStream as unknown as Boundary["openChunkedStream"],
  seekStart,
  openFragmentStream: openFragmentStream as unknown as Boundary["openFragmentStream"],
  getStream: async (track) => {
    if (!behavior.stream) throw new Error("테스트가 스트림을 정하지 않았다");
    return behavior.stream(track as QueuedTrack);
  },
  directStream: (async (url: string, opts?: { startMs?: number; liveOnly?: boolean }) => {
    calls.directStreams.push(url);
    return behavior.directStream ? behavior.directStream(url, opts) : Object.assign(new PassThrough(), { live: false, bounded: false });
  }) as unknown as Boundary["directStream"],
  fetch: (async (url: string, init: FetchInit) => {
    calls.fetches.push({ url, init });
    if (behavior.fetch) return behavior.fetch(url, init);
    return { ok: true, status: 200, body: new PassThrough() };
  }) as unknown as Boundary["fetch"],
};
Player.useBoundary(fakes);

// ── 6. 헬퍼 ────────────────────────────────────────────────────────
// 서버마다의 레지스트리. 운영에서는 조립이 하나 만들어 넘기고, 하네스는 가짜 서버마다 하나를 둔다
const registries = new WeakMap<object, InstanceType<typeof PlayerRegistry>>();
/** 이 플레이어의 서버 레지스트리 */
const registryOf = (player: Pick<Player, "guild">) => registries.get(player.guild);

function fakeGuild(id = "g1"): Guild {
  const client = { user: { id: "bot" }, guilds: { fetch: async () => null } };
  const guild = {
    id,
    name: `서버 ${id}`,
    client,
    channels: { cache: new Map() },
    members: { me: { user: { id: "bot" }, id: "bot" } },
    voiceAdapterCreator: () => ({}),
  };
  registries.set(guild, new PlayerRegistry());
  return guild as unknown as Guild;
}

type PlayerClass<P extends Player> = new (...args: ConstructorParameters<typeof Player>) => P;

/**
 * 플레이어 하나. 연결은 이미 붙은 것으로 둔다(play() 의 "연결" 단계는 따로 테스트한다).
 * as 로 하위 클래스를 주면 그것으로 세운다(테스트가 일부 메서드를 정할 때).
 */
function makePlayer<P extends Player = Player>({ connected = true, guildId = "g1", as }: { connected?: boolean; guildId?: string; as?: PlayerClass<P> } = {}): P {
  const guild = fakeGuild(guildId);
  const send = async (message: unknown) => {
    calls.sent.push(message);
    return {};
  };
  const text = { id: "text1", name: "text", send } as unknown as GuildTextBasedChannel;
  const voice = { id: "voice1", name: "voice" } as unknown as VoiceBasedChannel;
  const Cls = as ?? (Player as unknown as PlayerClass<P>);
  const player = new Cls(guild, text, voice);
  registryOf(player)?.set(guild.id, player);
  if (connected) player.connection = fakeConnection();
  return player;
}

/** 캐시 파일을 만든다. 키로 찾는 경로(audioCache.getFilePath)에 둔다. */
function writeCacheFile(key: string, bytes = "opus") {
  const file = audioCache.getFilePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

/**
 * 다운로드해 둔 곡을 심는다. 파일과 audio_cache 행을 같이. 실제로 다운로드한 곡과 같은 모양이어야
 * 링크 데이터 기록(외래 키로 audio_cache 행을 요구한다)이 운영과 같게 돈다.
 */
function seedCache(key: string, track: QueuedTrack, { durationSec = 200 } = {}) {
  const file = writeCacheFile(key);
  audioCache.recordDownloadStart(key, track);
  audioCache.recordDownloadComplete(key, file, fs.statSync(file).size, track, { durationSec });
  return file;
}

function reset() {
  for (const list of Object.values(calls)) if (Array.isArray(list)) list.length = 0;
  calls.settings = 0;
  for (const k of Object.keys(behavior) as Array<keyof Behavior>) behavior[k] = null;
  inFlight.clear();
  Object.assign(caps, { ok: true, https: true, hls: true, dash: true, segMaxRetry: true });
  // 캐시 길이 상한은 기본값(60분)으로. 테스트는 로컬 .env 를 읽으므로 운영자가 바꾼 값이 새어 든다
  config.cache.maxTrackSec = DEFAULT_MAX_TRACK_SEC;
  cacheDb.get().exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
  fs.rmSync(audioCache.cacheDir(), { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
}

/** 타이머를 남기지 않게 정리한다. 테스트 끝에 부른다. */
function dispose(player: Player) {
  player._stopTimers();
  player.sponsorSkipper?.stop();
  player.warmer?.stop?.();
}

/** 링크 데이터에서 한 행. 없으면 null. */
const lookupRow = (requestKey: string) => cacheDb.get().prepare<[string], LookupRow>("SELECT * FROM track_lookup WHERE request_key = ?").get(requestKey) || null;
const audioRow = (key: string) => cacheDb.get().prepare<[string], AudioRow>("SELECT * FROM audio_cache WHERE audio_key = ?").get(key) || null;

/** 걸어 둔 타이머의 시간(Node 타이머의 내부 필드). 치운 타이머는 -1 */
const timerDelay = (timer: unknown) => (timer as { _idleTimeout?: number } | null)?._idleTimeout;

/** 플레이어의 가짜 오디오 플레이어. 테스트가 멈춘 횟수 · 튼 것을 본다 */
const fakeAudioOf = (player: Player) => player.audioPlayer as unknown as FakeAudioPlayer;

export { Player, audioCache, AudioPlayerStatus, calls, behavior, caps, makePlayer, writeCacheFile, seedCache, reset, dispose, lookupRow, audioRow, fakeAudioOf, timerDelay, fakeConnection, fakeGuild, registryOf, TMP };
export type { FakeChild, FakeResource, Behavior };
