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
import { PassThrough, Writable } from "stream";

// 판정 시험에서 무엇이 불렸는지 모은다. 시험마다 reset() 으로 비운다
import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const calls = { spawns: [], resources: [], chunked: [], fetches: [], downloads: [], persists: [], directStreams: [], sink: [], steps: [] };

// ── 1. 음성 라이브러리 ──────────────────────────────────────────────────
import { AudioPlayerStatus } from "@discordjs/voice";

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
function spawnFfmpeg(args, label) {
  const child = fakeChild(args, label);
  calls.spawns.push(child);
  return child;
}
const caps = { ok: true, https: true, hls: true, dash: true, segMaxRetry: true };

// ── 3. 청크 스트림 ─────────────────────────────────────────────────────
async function openChunkedStream(opts) {
  calls.chunked.push(opts);
  const stream = new PassThrough();
  stream.stats = () => ({ requests: 1, received: 0, totalBytes: opts.totalBytes, idleMs: 0, expiresInS: null });
  return stream;
}

// ── 4. 캐시 장부: 진짜를 임시 DB 로 ──────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "player-harness-"));
const audioCache = (await import("../../src/store/audioCache.ts")).default;
audioCache._cacheDir = path.join(TMP, "audio_cache");
audioCache.initialize(path.join(TMP, "cache.db"));

// ── 5. 이제 MusicPlayer 와 협력자를 불러 메서드를 바꾼다 ────────────────
const MusicPlayer = (await import("../../src/player/Player.js")).default;
const equivalent = (await import("../../src/sources/youtube/equivalent.js")).default;
const TrackDownloader = (await import("../../src/media/cacheDownload.js")).default;
const SponsorBlock = (await import("../../src/sources/sponsorBlock.js")).default;
const VoiceConnectionManager = (await import("../../src/player/voiceConnection.js")).default;
const SessionPersistence = (await import("../../src/player/sessionMirror.js")).default;
const QueueWarmer = (await import("../../src/player/queueWarmer.js")).default;

// 협력 모듈 가짜. 플레이어의 바깥 경계(createVoice · createPersistence · createWarmer)로 넘긴다
const fakeConnection = () => Object.assign(new EventEmitter(), { state: { status: "ready" }, destroy() {}, subscribe() {} });
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
  async persistState(reason) {
    calls.persists.push(reason);
  }
  startStateSync() {}
  stopStateSync() {}
  scheduleStatePersist(reason) {
    calls.persists.push(`schedule:${reason}`);
  }
  removeSession() {
    calls.persists.push("remove");
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
const behavior = {
  stream: null, // (track, seekSec) → streamInfo. 던지면 스트림 실패
  equivalent: null, // (track) → youtubeUrl. 스포티파이 동등물
  sponsor: null, // (track) → SponsorBlock.forTrack 의 답
  download: null, // (track) → Promise<file>. 기본은 끝나지 않는 약속
  fetch: null, // (url, init) → Response 비슷한 것
  directStream: null, // (url) → Readable
};

equivalent.findYouTubeEquivalent = async (track) => {
  calls.steps.push("equivalent");
  const url = behavior.equivalent ? behavior.equivalent(track) : null;
  if (url) {
    track.audioUrl = url;
  }
  return url;
};
// 진짜처럼 영상 id 를 알 때만 답한다(스포티파이는 동등물을 찾은 뒤)
SponsorBlock.forTrack = async (track) => {
  calls.steps.push("sponsor");
  if (!SponsorBlock._trackVideoId(track)) return null;
  return behavior.sponsor ? behavior.sponsor(track) : null;
};
// 진짜 다운로드는 첫 await 전에 두 가지를 동기로 한다. 장부에 "받는 중" 행을 만들고(recordDownloadStart),
// 받는 중 목록에 올린다. play() 끝의 링크 장부 기록이 그 행에 기대므로(외래 키) 가짜도 똑같이 해야 한다.
const inFlight = new Map();
TrackDownloader.isDownloading = (filepath) => inFlight.has(filepath);
TrackDownloader.waitFor = (filepath) => inFlight.get(filepath) ?? null;
TrackDownloader.prototype.downloadTrack = function (track) {
  calls.downloads.push(track);
  const key = require("../../src/rules/audioKeyOf.ts").audioKeyOf(track.audioUrl);
  if (key) audioCache.recordDownloadStart(key, track);
  const filepath = this.trackFilePath(track);
  const running = behavior.download ? Promise.resolve().then(() => behavior.download(track)) : new Promise(() => {});
  inFlight.set(filepath, running);
  running.then(
    () => inFlight.delete(filepath),
    () => inFlight.delete(filepath),
  );
  return running;
};
// 플레이어의 바깥 경계. 이 뒤로 만드는 플레이어가 모두 쓴다
MusicPlayer.useBoundary({
  createAudioPlayer: () => new FakeAudioPlayer(),
  createVoice: (player) => new FakeVoice(player),
  createPersistence: (player) => new FakePersistence(player),
  createWarmer: (player, deps) => new FakeWarmer(player, deps),
  createAudioResource,
  spawnFfmpeg,
  ffmpegCapabilities: () => caps,
  openChunkedStream,
  getStream: async (track, seekSec) => {
    if (!behavior.stream) throw new Error("시험이 스트림을 정하지 않았다");
    return behavior.stream(track, seekSec);
  },
  directStream: async (url) => {
    calls.directStreams.push(url);
    return behavior.directStream ? behavior.directStream(url) : new PassThrough();
  },
  fetch: async (url, init) => {
    calls.fetches.push({ url, init });
    if (behavior.fetch) return behavior.fetch(url, init);
    return { ok: true, status: 200, body: new PassThrough() };
  },
});

// ── 6. 도우미 ────────────────────────────────────────────────────────
function fakeGuild(id = "g1") {
  const client = { players: new Map(), user: { id: "bot" }, guilds: { fetch: async () => null } };
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

/** 캐시 파일을 만든다. 열쇠로 찾는 경로(audioCache.getFilePath)에 둔다. */
function writeCacheFile(key, bytes = "opus") {
  const file = audioCache.getFilePath(key);
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
  audioCache.recordDownloadStart(key, track);
  audioCache.recordDownloadComplete(key, file, fs.statSync(file).size, track, { durationSec });
  return file;
}

function reset() {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  for (const k of Object.keys(behavior)) behavior[k] = null;
  inFlight.clear();
  Object.assign(caps, { ok: true, https: true, hls: true, dash: true, segMaxRetry: true });
  audioCache.db.exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
  fs.rmSync(audioCache._cacheDir, { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(audioCache._cacheDir, { recursive: true });
}

/** 타이머를 남기지 않게 정리한다. 시험 끝에 부른다. */
function dispose(player) {
  player.releaseResources();
  player.sponsorSkipper?.stop();
  player.warmer?.stop?.();
}

/** 장부에서 한 줄. 없으면 null. */
const lookupRow = (requestKey) => audioCache.db.prepare("SELECT * FROM track_lookup WHERE request_key = ?").get(requestKey) || null;
const audioRow = (key) => audioCache.db.prepare("SELECT * FROM audio_cache WHERE audio_key = ?").get(key) || null;

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
  TMP,
};
export default exported;
export { exported as "module.exports" };
