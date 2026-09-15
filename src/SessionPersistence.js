"use strict";

const fsSync = require("fs");
const log = require("./logger").child({ category: "session" });
const CacheManager = require("./CacheManager");
const trackState = require("./trackState");
const { formatDuration } = require("./utils");
const { escapeMd } = require("./mentions");
const { scheduleDelete } = require("./playbackResponder");

const HEARTBEAT_MS = 5000;

// 저장한 직후 메모리를 비우는 경로다. 거울을 붙인 채 비우면 방금 저장한 트랙이 DB에서 지워진다.
const FINAL_REASONS = new Set(["leave", "shutdown"]);

// 기동이 DB를 연 뒤에만 쓴다 — DB를 열지 않은 채 플레이어를 만드는 테스트가 실제 DB 파일을 건드리지 않게.
const liveStore = () => (CacheManager._initialized ? CacheManager.sessions : null);

// 재생 위치는 플레이어마다 타이머를 두지 않고 하나로 모아 한 트랜잭션에 쓴다.
const active = new Set();
let heartbeat = null;

function beat() {
  const store = liveStore();
  if (!store) return;
  const entries = [];
  for (const sp of active) {
    const p = sp.player;
    if (sp.frozen || !p.guild?.id || !p.currentTrack || p.paused) continue;
    if (sp.dirty) sp.resync(store);
    entries.push({ guildId: p.guild.id, positionMs: p.getCurrentTime() || 0, startOffsetMs: p.currentTrackStartOffsetMs || 0 });
  }
  if (entries.length === 0) return;
  try {
    store.savePositions(entries);
  } catch (error) {
    log.error("재생 위치 저장 실패:", error.message);
  }
}

class SessionPersistence {
  constructor(player) {
    this.player = player;
    this.frozen = false; // 마지막 저장 뒤 — 이후의 트랙 변경은 DB에 옮기지 않는다
    this.dirty = false; // 증분 쓰기가 실패해 DB가 메모리와 어긋났을 수 있다
    this.saveTimer = null;
  }

  // ── 트랙 거울 (trackState가 부른다) ──

  _mirror(write) {
    const guildId = this.player.guild?.id;
    const store = liveStore();
    if (this.frozen || !guildId || !store) return;
    if (this.dirty) return this.resync(store);
    try {
      // 옮길 행이 없었다 = 이미 어긋나 있었다
      if (write(store, guildId) === false) this.resync(store);
    } catch (error) {
      this.dirty = true;
      log.warn(`세션 트랙 저장 실패 — 다음 변경에서 통째로 다시 씁니다 (서버 ID ${guildId}): ${error.message}`);
    }
  }

  resync(store = liveStore()) {
    const p = this.player;
    if (this.frozen || !store || !p.guild?.id) return;
    try {
      store.replaceTracks(p.guild.id, { current: p.currentTrack, queue: p.queue, history: p.previousTracks });
      this.dirty = false;
    } catch (error) {
      this.dirty = true;
      log.error(`세션 트랙 재기록 실패 (서버 ID ${p.guild.id}): ${error.message}`);
    }
  }

  onSetCurrent(track) {
    this._mirror((s, g) => s.setCurrent(g, track));
  }

  onEnqueue(tracks, front) {
    this._mirror((s, g) => s.append(g, tracks, { front }));
  }

  onTake(index) {
    this._mirror((s, g) => s.take(g, index));
  }

  onRetire(track, requeue) {
    this._mirror((s, g) => s.retire(g, track, { requeue }));
  }

  onRemoveAt(index) {
    this._mirror((s, g) => s.removeAt(g, index));
  }

  onMove(from, to) {
    this._mirror((s, g) => s.move(g, from, to));
  }

  onClearQueue() {
    this._mirror((s, g) => s.clearQueue(g));
  }

  onReset(history) {
    this._mirror((s, g) => s.reset(g, { history }));
  }

  onReplace() {
    this.resync();
  }

  // ── 세션 행 ──

  sessionFields() {
    const p = this.player;
    return {
      voiceChannelId: p.voiceChannel?.id || null,
      textChannelId: p.textChannel?.id || null,
      volume: p.volume,
      loopMode: p.loop === "track" || p.loop === "queue" ? p.loop : "off",
      autoplay: p.autoplay || null,
      // 복원하는 건 수동 일시정지뿐이다 — 혼자 남음 같은 사유는 복원 시점의 상황이 다시 건다
      pausedManual: Boolean(p.paused) && Boolean(p.pauseReasons?.has("manual")),
      positionMs: p.getCurrentTime?.() || 0,
      startOffsetMs: p.currentTrackStartOffsetMs || 0,
      requesterId: p.requesterId || null,
      nowPlayingMessageId: p.nowPlayingMessage?.id || null,
    };
  }

  async persistState(reason = "manual", immediate = false) {
    const p = this.player;
    if (immediate) this.cancelStateSave();
    const store = liveStore();
    if (this.frozen || !p.guild?.id || !store) return;
    try {
      if (!p.currentTrack && p.queue.length === 0) {
        store.removeSession(p.guild.id);
      } else {
        if (this.dirty) this.resync(store);
        store.saveSession(p.guild.id, this.sessionFields());
      }
    } catch (error) {
      log.error(`세션 저장 실패 (서버 ID ${p.guild.id}):`, error.message || error);
    }
    if (FINAL_REASONS.has(reason)) this.frozen = true;
  }

  removeSession() {
    const store = liveStore();
    const guildId = this.player.guild?.id;
    if (!store || !guildId) return;
    try {
      store.removeSession(guildId);
    } catch (error) {
      log.error(`세션 삭제 실패 (서버 ID ${guildId}):`, error.message);
    }
  }

  startStateSync() {
    active.add(this);
    if (!heartbeat) {
      heartbeat = setInterval(beat, HEARTBEAT_MS);
      heartbeat.unref?.();
    }
  }

  stopStateSync() {
    active.delete(this);
    if (active.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    this.cancelStateSave();
  }

  cancelStateSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  scheduleStatePersist(reason = "update", delay = 200) {
    this.cancelStateSave();
    this.saveTimer = setTimeout(
      () => {
        this.saveTimer = null;
        this.persistState(reason).catch(() => {});
      },
      Math.max(delay, 0),
    );
  }

  // ── 복원 ──

  reviveTrack(data) {
    if (!data) return null;
    const { requesterId, ...track } = data;
    // 요청자는 권한 판정과 멘션에 id만 쓰인다
    if (requesterId) track.requestedBy = { id: requesterId };
    return track;
  }

  async restoreFromState(record) {
    const player = this.player;
    if (!record || !player.guild?.id) return;
    const { session } = record;
    this.stopStateSync();
    player.pauseReasons = new Set();

    player.volume = typeof session.volume === "number" ? session.volume : player.volume;
    player.loop = session.loopMode === "track" || session.loopMode === "queue" ? session.loopMode : false;
    player.autoplay = session.autoplay || false;
    player.requesterId = session.requesterId || player.requesterId;

    trackState.restore(player, {
      current: this.reviveTrack(record.current),
      queue: record.queue.map((t) => this.reviveTrack(t)),
      history: record.history.map((t) => this.reviveTrack(t)),
    });

    if (!player.currentTrack && player.queue.length > 0) {
      trackState.shiftNext(player);
    }

    // 받아 둔 파일 경로는 저장하지 않는다 — 내려받을 때와 같은 식으로 캐시 키에서 다시 구한다
    const key = player.currentTrack?.audioSourceKey || player.currentTrack?.url;
    const file = key ? CacheManager.getFilePath(key) : null;
    player.currentDownloadedFile = file && fsSync.existsSync(file) ? file : null;

    const trackDurationMs = player.currentTrack?.duration ? Number(player.currentTrack.duration) * 1000 : null;
    let resumeMs = Math.max(0, Number(session.positionMs) || 0);
    if (trackDurationMs && resumeMs > Math.max(trackDurationMs - 2000, 0)) {
      resumeMs = 0;
    }

    player.currentTrackStartOffsetMs = Math.max(Number(session.startOffsetMs) || 0, 0);
    player.lastPlaybackPosition = resumeMs;
    player.paused = false;

    if (!player.connection) {
      try {
        const connected = await player.connect();
        if (!connected) {
          throw new Error("Failed to reconnect to voice channel");
        }
      } catch (error) {
        log.error("세션 복원 중 음성 연결 실패:", error.message);
        throw new Error("Failed to reconnect to voice channel", { cause: error });
      }
    }

    if (!player.currentTrack) {
      this.removeSession();
      return;
    }

    if (session.pausedManual) player.pauseReasons.add("manual"); // play()가 시작 직후 즉시 일시정지

    await player.play(null, resumeMs);
    if (session.pausedManual) player.pauseFor("manual"); // paused 플래그 동기화 (UI/직렬화 일관성)

    if (player.resource?.volume) {
      player.resource.volume.setVolume(player.volume / 100);
    }

    const embedManager = player.guild?.client?.musicEmbedManager;
    if (embedManager && player.textChannel) {
      try {
        // 이전 세션의 오래된 현재 재생 메시지 제거;
        // 웹훅 소유이거나 CV2일 수 있어 제자리 수정은 신뢰할 수 없음
        if (session.nowPlayingMessageId) {
          const oldMessage = await player.textChannel.messages.fetch(session.nowPlayingMessageId).catch(() => null);
          if (oldMessage) await oldMessage.delete().catch(() => {});
        }

        // 새 CV2 현재 재생 메시지 전송 (진행 갱신도 시작). 복구에는 진입점 자리표시자가 없다.
        const requester = { id: session.requesterId || player.guild.client.user.id };
        await embedManager.createNewMusicEmbed(player, player.currentTrack, requester);
      } catch (error) {
        log.error("세션 복원 중 재생 임베드 복구 실패:", error?.message || error);
      }
    }

    if (player.textChannel && player.currentTrack) {
      try {
        const title = escapeMd(player.currentTrack.title || "Unknown");
        const at = formatDuration(Math.floor(resumeMs / 1000));
        const content = player.paused ? `⏸️ 일시정지 상태로 복원됨 • **${title}** (${at})` : `▶️ 음악 재개됨 • **${title}** (${at})`;
        scheduleDelete(await player.textChannel.send({ content }));
      } catch {
        // 메시지를 보낼 수 없으면 무시
      }
    }

    this.scheduleStatePersist("restored", 1000);
  }
}

module.exports = SessionPersistence;
module.exports._beat = beat;
