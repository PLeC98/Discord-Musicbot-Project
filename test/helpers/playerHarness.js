"use strict";

// 진짜 MusicPlayer 를 세워 play() 를 끝까지 돌리는 하네스.
//
// 다른 테스트는 가짜 객체에 메서드를 빌려 붙여 조각을 시험한다. 그래서 생성자와 협력자가 다 얽힌
// play() 는 한 번도 돌지 않았다. 여기서는 플레이어를 진짜로 만들고, 바깥과 닿는 곳만 갈아 끼운다.
//
//   음성 라이브러리 · ffmpeg · 청크 스트림  MusicPlayer 가 불러올 때 구조 분해로 가져간다. 불러오기 전에 바꾼다
//   캐시 장부                              진짜 CacheManager 를 임시 DB 로. "장부에 무엇을 적었나"를 그대로 본다
//   스트림 주소 · 다운로드 · SponsorBlock   모듈 객체의 메서드를 시험마다 바꾼다
//   음성 연결 · 세션 저장 · 예열            연결은 붙은 것으로, 저장은 부른 것만 기록한다
//
// 이 파일을 MusicPlayer 보다 먼저 불러와야 한다. node --test 는 테스트 파일마다 프로세스를 따로 띄우므로
// 여기서 바꿔 끼운 모듈이 다른 테스트 파일로 새지 않는다.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough, Writable } = require("stream");

// 판정 시험에서 무엇이 불렸는지 모은다. 시험마다 reset() 으로 비운다
const calls = { spawns: [], resources: [], chunked: [], fetches: [], downloads: [], persists: [], directStreams: [], sink: [], steps: [] };

// ── 1. 음성 라이브러리 ──────────────────────────────────────────────────
const realVoice = require("@discordjs/voice");
const { AudioPlayerStatus } = realVoice;

class FakeAudioPlayer extends EventEmitter {
  constructor() {
    super();
    this.state = { status: AudioPlayerStatus.Idle };
    this.played = [];
    this.stops = 0;
  }
  play(resource) {
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

function createAudioResource(input, options = {}) {
  const resource = {
    input,
    options,
    metadata: options.metadata,
    playbackDuration: 0,
    volume: {
      value: null,
      setVolume(v) {
        this.value = v;
      },
    },
    encoder: {
      bitrate: null,
      setBitrate(b) {
        this.bitrate = b;
      },
    },
    playStream: { destroy() {} },
  };
  calls.resources.push(resource);
  return resource;
}

require.cache[require.resolve("@discordjs/voice")] = {
  id: "@discordjs/voice",
  loaded: true,
  exports: { ...realVoice, createAudioPlayer: () => new FakeAudioPlayer(), createAudioResource },
};

// ── 2. ffmpeg ─────────────────────────────────────────────────────────
function fakeChild(args, label) {
  const child = new EventEmitter();
  child.args = args;
  child.label = label;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({ write: (_c, _e, done) => done() });
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}
const ffmpegProcessPath = require.resolve("../../src/media/ffmpeg/process");
const realFfmpegProcess = require("../../src/media/ffmpeg/process");
require.cache[ffmpegProcessPath].exports = {
  ...realFfmpegProcess,
  spawnFfmpeg: (args, label) => {
    const child = fakeChild(args, label);
    calls.spawns.push(child);
    return child;
  },
};

const ffmpegPathPath = require.resolve("../../src/media/ffmpeg/path");
const realFfmpegPath = require("../../src/media/ffmpeg/path");
const caps = { ok: true, https: true, hls: true, segMaxRetry: true };
require.cache[ffmpegPathPath].exports = { ...realFfmpegPath, capabilities: () => caps };

// ── 3. 청크 스트림 ─────────────────────────────────────────────────────
const chunkedPath = require.resolve("../../src/media/chunkedStream");
const realChunked = require("../../src/media/chunkedStream");
require.cache[chunkedPath].exports = {
  ...realChunked,
  openChunkedStream: async (opts) => {
    calls.chunked.push(opts);
    const stream = new PassThrough();
    stream.stats = () => ({ requests: 1, received: 0, totalBytes: opts.totalBytes, idleMs: 0, expiresInS: null });
    return stream;
  },
};

// ── 4. 캐시 장부: 진짜를 임시 DB 로 ──────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "player-harness-"));
const CacheManager = require("../../src/store/cacheManager");
CacheManager._cacheDir = path.join(TMP, "audio_cache");
CacheManager.initialize(path.join(TMP, "cache.db"));

// ── 5. 이제 MusicPlayer 와 협력자를 불러 메서드를 바꾼다 ────────────────
const MusicPlayer = require("../../src/MusicPlayer");
const TrackResolver = require("../../src/sources/trackResolver");
const TrackDownloader = require("../../src/media/cacheDownload");
const SponsorBlock = require("../../src/sources/sponsorBlock");
const DirectLink = require("../../src/sources/direct");
const VoiceConnectionManager = require("../../src/VoiceConnectionManager");
const SessionPersistence = require("../../src/SessionPersistence");
const QueueWarmer = require("../../src/QueueWarmer");

const fakeConnection = () => Object.assign(new EventEmitter(), { state: { status: "ready" }, destroy() {}, subscribe() {} });
VoiceConnectionManager.prototype.startConnectionHealthCheck = function () {};
VoiceConnectionManager.prototype.setupConnectionEvents = function () {};
VoiceConnectionManager.prototype.connect = async function () {
  this.player.connection = fakeConnection();
  return true;
};
VoiceConnectionManager.prototype.disconnect = function () {
  this.player.connection = null;
};

SessionPersistence.prototype._mirror = function () {};
SessionPersistence.prototype.persistState = async function (reason) {
  calls.persists.push(reason);
};
SessionPersistence.prototype.startStateSync = function () {};
SessionPersistence.prototype.stopStateSync = function () {};
SessionPersistence.prototype.scheduleStatePersist = function (reason) {
  calls.persists.push(`schedule:${reason}`);
};
SessionPersistence.prototype.removeSession = function () {
  calls.persists.push("remove");
};
// 대기열이 바뀔 때 세션 저장이 받는 알림. 어떤 알림이 어떤 순서로 가는지만 남긴다
for (const name of ["onSetCurrent", "onEnqueue", "onTake", "onRetire", "onRewind", "onRemoveAt", "onMove", "onClearQueue", "onReset", "onReplace"]) {
  SessionPersistence.prototype[name] = function () {
    calls.sink.push(name);
  };
}
QueueWarmer.prototype.start = function () {};

// 시험마다 바꾸는 협력자. 기본값은 "아무 일도 안 일어남"
const behavior = {
  stream: null, // (track, seekSec) → streamInfo. 던지면 스트림 실패
  equivalent: null, // (track) → youtubeUrl. 스포티파이 동등물
  sponsor: null, // (track) → track.sponsor 에 넣을 값
  download: null, // (track) → Promise<file>. 기본은 끝나지 않는 약속
  fetch: null, // (url, init) → Response 비슷한 것
  directStream: null, // (url) → Readable
};

TrackResolver.getStream = async (track, seekSec) => {
  if (!behavior.stream) throw new Error("시험이 스트림을 정하지 않았다");
  return behavior.stream(track, seekSec);
};
TrackResolver.findYouTubeEquivalent = async (track) => {
  calls.steps.push("equivalent");
  const url = behavior.equivalent ? behavior.equivalent(track) : null;
  if (url) {
    track.youtubeUrl = url;
    TrackResolver.ensureAudioSourceKey(track);
  }
  return url;
};
// 진짜처럼 영상 id 를 알 수 있을 때만 확정한다. 모르면 다음 호출에 다시 본다(스포티파이는 동등물을 찾은 뒤)
SponsorBlock.ensureForTrack = async (track) => {
  calls.steps.push("sponsor");
  if (!track || track._sponsorResolved) return;
  if (!SponsorBlock._trackVideoId(track)) return;
  if (behavior.sponsor && !track.sponsor) track.sponsor = behavior.sponsor(track);
  track._sponsorResolved = true;
};
// 진짜 다운로드는 첫 await 전에 두 가지를 동기로 한다. 장부에 "받는 중" 행을 만들고(recordDownloadStart),
// 받는 중 목록에 올린다. play() 끝의 링크 장부 기록이 그 행에 기대므로(외래 키) 가짜도 똑같이 해야 한다.
const inFlight = new Map();
TrackDownloader.isDownloading = (filepath) => inFlight.has(filepath);
TrackDownloader.waitFor = (filepath) => inFlight.get(filepath) ?? null;
TrackDownloader.prototype.downloadTrack = function (track) {
  calls.downloads.push(track);
  if (track.audioSourceKey) CacheManager.recordDownloadStart(track.audioSourceKey, track);
  const filepath = this.trackFilePath(track);
  const running = behavior.download ? Promise.resolve().then(() => behavior.download(track)) : new Promise(() => {});
  inFlight.set(filepath, running);
  running.then(
    () => inFlight.delete(filepath),
    () => inFlight.delete(filepath),
  );
  return running;
};
DirectLink.getStream = async (url) => {
  calls.directStreams.push(url);
  return behavior.directStream ? behavior.directStream(url) : new PassThrough();
};
global.fetch = async (url, init) => {
  calls.fetches.push({ url, init });
  if (behavior.fetch) return behavior.fetch(url, init);
  return { ok: true, status: 200, body: new PassThrough() };
};

// ── 6. 도우미 ────────────────────────────────────────────────────────
function fakeGuild(id = "g1") {
  const client = { players: new Map(), musicEmbedManager: null, user: { id: "bot" }, guilds: { fetch: async () => null } };
  return {
    id,
    name: `서버 ${id}`,
    client,
    channels: { cache: new Map() },
    members: { me: { user: { id: "bot" }, id: "bot" } },
    voiceAdapterCreator: () => ({}),
  };
}

/** 플레이어 하나. 연결은 이미 붙은 것으로 둔다(play() 의 "연결" 단계는 따로 시험한다). */
function makePlayer({ connected = true, guildId = "g1" } = {}) {
  const guild = fakeGuild(guildId);
  const text = { id: "text1", name: "text", send: async () => ({}) };
  const voice = { id: "voice1", name: "voice" };
  const player = new MusicPlayer(guild, text, voice);
  guild.client.players.set(guild.id, player);
  if (connected) player.connection = fakeConnection();
  return player;
}

/** 캐시 파일을 만든다. 열쇠로 찾는 경로(CacheManager.getFilePath)에 둔다. */
function writeCacheFile(key, bytes = "opus") {
  const file = CacheManager.getFilePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

/**
 * 받아 둔 곡을 심는다. 파일과 audio_cache 행을 같이. 실제로 받은 곡과 같은 모양이어야
 * 장부 기록(외래 키로 audio_cache 행을 요구한다)이 운영과 같게 돈다.
 */
function seedCache(key, track, { durationSec = 200 } = {}) {
  const file = writeCacheFile(key);
  CacheManager.recordDownloadStart(key, track);
  CacheManager.recordDownloadComplete(key, file, fs.statSync(file).size, track, { durationSec });
  return file;
}

function reset() {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  for (const k of Object.keys(behavior)) behavior[k] = null;
  inFlight.clear();
  Object.assign(caps, { ok: true, https: true, hls: true, segMaxRetry: true });
  CacheManager.db.exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
  fs.rmSync(CacheManager._cacheDir, { recursive: true, force: true });
  fs.mkdirSync(CacheManager._cacheDir, { recursive: true });
}

/** 타이머를 남기지 않게 정리한다. 시험 끝에 부른다. */
function dispose(player) {
  player.releaseResources();
  player.sponsorSkipper?.stop();
  player.warmer?.stop?.();
}

/** 장부에서 한 줄. 없으면 null. */
const lookupRow = (sourceUrl) => CacheManager.db.prepare("SELECT * FROM track_lookup WHERE source_url = ?").get(sourceUrl) || null;
const audioRow = (key) => CacheManager.db.prepare("SELECT * FROM audio_cache WHERE audio_source_key = ?").get(key) || null;

module.exports = {
  MusicPlayer,
  CacheManager,
  TrackResolver,
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
  TMP,
};
