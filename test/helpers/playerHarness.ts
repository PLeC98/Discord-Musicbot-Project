// 진짜 MusicPlayer 를 세워 play() 를 끝까지 돌리는 하네스.
//
// 다른 테스트는 가짜 객체에 메서드를 빌려 붙여 조각을 시험한다. 그래서 생성자와 협력자가 다 얽힌
// play() 는 한 번도 돌지 않았다. 여기서는 플레이어를 진짜로 만들고, 바깥과 닿는 곳만 갈아 끼운다.
//
//   음성 라이브러리 · ffmpeg · 청크 스트림 · HTTP · 직접 링크 · 스트림 주소
//                                          플레이어의 바깥 경계로 넘긴다(MusicPlayer.useBoundary). 명령 · 곡 추가가
//                                          만드는 플레이어도 같은 가짜를 쓴다
//   캐시 장부                              진짜 audioCache 를 임시 DB 로. "장부에 무엇을 적었나"를 그대로 본다
//   다운로드 · SponsorBlock · 동등물        모듈 객체의 메서드를 시험마다 바꾼다
//   음성 연결 · 세션 저장 · 예열            연결은 붙은 것으로, 저장은 부른 것만 기록한다
//
// node --test 는 테스트 파일마다 프로세스를 따로 띄우므로 여기서 바꾼 것이 다른 테스트 파일로 새지 않는다.

import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { PassThrough, Writable, type Readable } from "stream";
import { audioKeyOf } from "../../src/rules/audioKeyOf.ts";
import type { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import type { Guild, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { MusicPlayer as Player, Boundary } from "../../src/player/Player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import type { DownloadTrack } from "../../src/media/cacheDownload.ts";
import type { ChunkedOptions } from "../../src/media/chunkedStream.ts";
import type { StreamInfo } from "../../src/sources/streamUrl.ts";
import type { Segments } from "../../src/sources/sponsorBlock.ts";
import type { RestoredSession } from "../../src/store/playerSessions.ts";
import type { AudioRow } from "../../src/store/audioCache.ts";
import type { LookupRow } from "../../src/store/rows.ts";

// 가짜 ffmpeg 프로세스와 오디오 리소스. 시험이 읽는 칸
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

// 판정 시험에서 무엇이 불렸는지 모은다. 시험마다 reset() 으로 비운다
const calls = {
  spawns: [] as FakeChild[],
  resources: [] as FakeResource[],
  chunked: [] as ChunkedOptions[],
  fetches: [] as Array<{ url: string; init: RequestInit }>,
  downloads: [] as DownloadTrack[],
  persists: [] as string[],
  directStreams: [] as string[],
  sink: [] as string[],
  steps: [] as string[],
};

// ── 1. 음성 라이브러리 ──────────────────────────────────────────────────
import { AudioPlayerStatus } from "@discordjs/voice";
import * as storeDb from "../../src/store/db.ts";

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
  return Object.assign(new PassThrough(), { stats: () => ({ requests: 1, received: 0, totalBytes: opts.totalBytes, idleMs: 0, expiresInS: null }) });
}

// ── 4. 캐시 장부: 진짜를 임시 DB 로 ──────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "player-harness-"));
const audioCache = await import("../../src/store/audioCache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
audioCache.initialize(path.join(TMP, "cache.db"));

// ── 5. 이제 MusicPlayer 와 협력자를 불러 메서드를 바꾼다 ────────────────
const MusicPlayer = (await import("../../src/player/Player.ts")).MusicPlayer;
const { TrackDownloader } = await import("../../src/media/cacheDownload.ts");
const SponsorBlock = await import("../../src/sources/sponsorBlock.ts");
const VoiceConnectionManager = (await import("../../src/player/voiceConnection.ts")).VoiceConnectionManager;
const SessionPersistence = (await import("../../src/player/sessionMirror.ts")).SessionPersistence;
const QueueWarmer = (await import("../../src/player/queueWarmer.ts")).QueueWarmer;

// 협력 모듈 가짜. 플레이어의 바깥 경계(createVoice · createPersistence · createWarmer)로 넘긴다
// 붙은 것으로 둔 연결. 시험은 emit 으로 상태를 흉내 낸다
const fakeConnection = () => Object.assign(new EventEmitter(), { state: { status: "ready" }, destroy() {}, subscribe() {} }) as unknown as VoiceConnection;
class FakeVoice extends VoiceConnectionManager {
  startConnectionHealthCheck() {}
  setupConnectionEvents() {}
  async connect() {
    this.player.connection = fakeConnection();
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
  scheduleStatePersist(reason: string) {
    calls.persists.push(`schedule:${reason}`);
  }
  removeSession() {
    calls.persists.push("remove");
  }
  // 시험이 되살리기를 정했으면 그것으로. 아니면 진짜
  async restoreFromState(record: RestoredSession | null | undefined) {
    if (behavior.restore) {
      await behavior.restore.call(this.player, record);
      return;
    }
    return super.restoreFromState(record);
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

// 시험마다 바꾸는 협력자. 기본값은 "아무 일도 안 일어남"
type Behavior = {
  stream: ((track: QueuedTrack, seekSec?: number) => StreamInfo | Promise<StreamInfo>) | null;
  equivalent: ((track: QueuedTrack) => string | null) | null;
  sponsor: ((track: QueuedTrack) => Segments | null | Promise<Segments | null>) | null;
  download: ((track: DownloadTrack) => string | Promise<string>) | null;
  fetch: ((url: string, init: RequestInit) => unknown) | null;
  directStream: ((url: string) => Readable | Promise<Readable>) | null;
  restore: ((this: Player, record: RestoredSession | null | undefined) => unknown) | null;
};
const behavior: Behavior = {
  stream: null, // (track, seekSec) → streamInfo. 던지면 스트림 실패
  equivalent: null, // (track) → youtubeUrl. 스포티파이 동등물
  sponsor: null, // (track) → SponsorBlock.forTrack 의 답
  download: null, // (track) → Promise<file>. 기본은 끝나지 않는 약속
  fetch: null, // (url, init) → Response 비슷한 것
  directStream: null, // (url) → Readable
  restore: null, // function (record) — this 는 플레이어. 세션 되살리기(명령 · 곡 추가의 갈래)
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
// 진짜 다운로드는 첫 await 전에 두 가지를 동기로 한다. 장부에 "받는 중" 행을 만들고(recordDownloadStart),
// 받는 중 목록에 올린다. play() 끝의 링크 장부 기록이 그 행에 기대므로(외래 키) 가짜도 똑같이 해야 한다.
// 받는 중 목록은 진짜 것을 쓴다. 그래야 받는 중인 파일을 캐시로 치지 않는 판정(findCacheFile)이 그대로 돈다
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
// 음성 라이브러리 · ffmpeg · 청크 스트림 · HTTP 가짜는 여기서 한 번씩 진짜 타입으로 본다(시험이 읽는 칸만 흉내 낸다)
const fakes: Partial<Boundary> = {
  createAudioPlayer: () => new FakeAudioPlayer() as unknown as AudioPlayer,
  createVoice: (player) => new FakeVoice(player),
  createPersistence: (player) => new FakePersistence(player),
  createWarmer: (player, deps) => new FakeWarmer(player, deps),
  createDownloader: (player) => new FakeDownloader(player),
  findEquivalent,
  sponsorFor,
  createAudioResource: createAudioResource as unknown as Boundary["createAudioResource"],
  spawnFfmpeg: spawnFfmpeg as unknown as Boundary["spawnFfmpeg"],
  ffmpegCapabilities: () => caps,
  openChunkedStream: openChunkedStream as unknown as Boundary["openChunkedStream"],
  getStream: async (track, seekSec) => {
    if (!behavior.stream) throw new Error("시험이 스트림을 정하지 않았다");
    return behavior.stream(track as QueuedTrack, seekSec);
  },
  directStream: async (url) => {
    calls.directStreams.push(url);
    return behavior.directStream ? behavior.directStream(url) : new PassThrough();
  },
  fetch: (async (url: string, init: RequestInit) => {
    calls.fetches.push({ url, init });
    if (behavior.fetch) return behavior.fetch(url, init);
    return { ok: true, status: 200, body: new PassThrough() };
  }) as unknown as Boundary["fetch"],
};
MusicPlayer.useBoundary(fakes);

// ── 6. 도우미 ────────────────────────────────────────────────────────
function fakeGuild(id = "g1"): Guild {
  const client = { players: new Map(), user: { id: "bot" }, guilds: { fetch: async () => null } };
  const guild = {
    id,
    name: `서버 ${id}`,
    client,
    channels: { cache: new Map() },
    members: { me: { user: { id: "bot" }, id: "bot" } },
    voiceAdapterCreator: () => ({}),
  };
  return guild as unknown as Guild;
}

/** 플레이어 하나. 연결은 이미 붙은 것으로 둔다(play() 의 "연결" 단계는 따로 시험한다). */
function makePlayer({ connected = true, guildId = "g1" } = {}) {
  const guild = fakeGuild(guildId);
  const text = { id: "text1", name: "text", send: async () => ({}) } as unknown as GuildTextBasedChannel;
  const voice = { id: "voice1", name: "voice" } as unknown as VoiceBasedChannel;
  const player = new MusicPlayer(guild, text, voice);
  guild.client.players.set(guild.id, player);
  if (connected) player.connection = fakeConnection();
  return player;
}

/** 캐시 파일을 만든다. 열쇠로 찾는 경로(audioCache.getFilePath)에 둔다. */
function writeCacheFile(key: string, bytes = "opus") {
  const file = audioCache.getFilePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

/**
 * 받아 둔 곡을 심는다. 파일과 audio_cache 행을 같이. 실제로 받은 곡과 같은 모양이어야
 * 장부 기록(외래 키로 audio_cache 행을 요구한다)이 운영과 같게 돈다.
 */
function seedCache(key: string, track: QueuedTrack, { durationSec = 200 } = {}) {
  const file = writeCacheFile(key);
  audioCache.recordDownloadStart(key, track);
  audioCache.recordDownloadComplete(key, file, fs.statSync(file).size, track, { durationSec });
  return file;
}

function reset() {
  for (const list of Object.values(calls)) list.length = 0;
  for (const k of Object.keys(behavior) as Array<keyof Behavior>) behavior[k] = null;
  inFlight.clear();
  Object.assign(caps, { ok: true, https: true, hls: true, dash: true, segMaxRetry: true });
  storeDb.get().exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
  fs.rmSync(audioCache.cacheDir(), { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
}

/** 타이머를 남기지 않게 정리한다. 시험 끝에 부른다. */
function dispose(player: Player) {
  player.releaseResources();
  player.sponsorSkipper?.stop();
  player.warmer?.stop?.();
}

/** 장부에서 한 줄. 없으면 null. */
const lookupRow = (requestKey: string) => storeDb.get().prepare<[string], LookupRow>("SELECT * FROM track_lookup WHERE request_key = ?").get(requestKey) || null;
const audioRow = (key: string) => storeDb.get().prepare<[string], AudioRow>("SELECT * FROM audio_cache WHERE audio_key = ?").get(key) || null;

/** 플레이어의 가짜 오디오 플레이어. 시험이 멈춘 횟수 · 튼 것을 본다 */
const fakeAudioOf = (player: Player) => player.audioPlayer as unknown as FakeAudioPlayer;

const exported = {
  MusicPlayer,
  audioCache,
  AudioPlayerStatus,
  calls,
  behavior,
  caps,
  makePlayer,
  writeCacheFile,
  seedCache,
  reset,
  dispose,
  lookupRow,
  audioRow,
  fakeAudioOf,
  fakeConnection,
  fakeGuild,
  TMP,
};
export default exported;
export type { FakeChild, FakeResource, Behavior };
export { exported as "module.exports" };
