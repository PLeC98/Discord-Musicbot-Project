import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "session" });
import db from "../store/db.ts";
import playerSessions from "../store/playerSessions.ts";
const { sessions } = playerSessions;
import trackState from "./trackState.js";
import config from "../../config.ts";
import playerEvents from "./events.js";

const HEARTBEAT_MS = 5000;

// 저장한 직후 메모리를 비우는 경로다. 거울을 붙인 채 비우면 방금 저장한 트랙이 DB에서 지워진다.
const FINAL_REASONS = new Set(["leave", "shutdown"]);

// 기동이 DB를 연 뒤에만 쓴다. DB를 열지 않은 채 플레이어를 만드는 테스트가 실제 DB 파일을 건드리지 않게.
const liveStore = () => (db.isOpen() ? sessions() : null);

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
    entries.push({ guildId: p.guild.id, positionMs: p.getCurrentTime() || 0, startOffsetMs: p.playback?.startOffsetMs || 0 });
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
    this.frozen = false; // 마지막 저장 뒤. 이후의 트랙 변경은 DB에 옮기지 않는다
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
      log.warn(`세션 트랙 저장 실패. 다음 변경에서 통째로 다시 씁니다 (서버 ID ${guildId}): ${error.message}`);
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

  onRewind(track, copy, current) {
    this._mirror((s, g) => s.rewind(g, track, { copy, current }));
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
      // 복원하는 건 수동 일시정지뿐이다. 혼자 남음 같은 사유는 복원 시점의 상황이 다시 건다
      pausedManual: Boolean(p.paused) && Boolean(p.pauseReasons?.has("manual")),
      positionMs: p.getCurrentTime?.() || 0,
      startOffsetMs: p.playback?.startOffsetMs || 0,
      requesterId: p.requesterId || null,
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

    // 미리 뽑아 둔 자동재생 곡은 복원하지 않는다. 사용자가 고른 곡만 세션에 남는 것이 자연스럽고,
    // 장르는 함께 복원되므로 첫 곡이 시작될 때 다시 뽑힌다. 요청자가 봇인 것으로 가른다.
    const botId = player.guild?.client?.user?.id || null;
    const queueRows = botId ? record.queue.filter((t) => t.requesterId !== botId) : record.queue;
    const droppedAutoplay = record.queue.length - queueRows.length;
    if (droppedAutoplay > 0) log.info(`복원에서 자동재생 곡 ${droppedAutoplay}곡 제외 (서버 ID ${player.guild.id})`);

    // 상한을 줄인 뒤 재시작하면 저장된 대기열이 넘친다. 잘라낸다. 잘랐으면 DB도 맞춰야 하니 다시 쓴다.
    const max = config.bot.maxQueueSize;
    const cut = max > 0 && queueRows.length > max;
    if (cut) log.info(`복원한 대기열이 상한을 넘어 잘라냄: ${queueRows.length}곡 → ${max}곡 (서버 ID ${player.guild.id})`);
    trackState.restore(
      player,
      {
        current: this.reviveTrack(record.current),
        queue: (cut ? queueRows.slice(0, max) : queueRows).map((t) => this.reviveTrack(t)),
        history: record.history.map((t) => this.reviveTrack(t)),
      },
      // 잘랐거나 걸러냈으면 메모리와 DB가 어긋난다. 다시 써서 맞춘다
      { persisted: !cut && droppedAutoplay === 0 },
    );

    if (!player.currentTrack && player.queue.length > 0) {
      trackState.shiftNext(player);
    }

    const trackDurationMs = player.currentTrack?.duration ? Number(player.currentTrack.duration) * 1000 : null;
    let resumeMs = Math.max(0, Number(session.positionMs) || 0);
    if (trackDurationMs && resumeMs > Math.max(trackDurationMs - 2000, 0)) {
      resumeMs = 0;
    }
    // 라이브에 저장된 위치는 의미가 없다. 어차피 지금 시점(라이브 엣지)으로만 붙는다.
    if (player.currentTrack?.isLive) resumeMs = 0;

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

    await player.play(resumeMs);
    if (session.pausedManual) player.pauseFor("manual"); // paused 플래그 동기화 (UI/직렬화 일관성)

    if (player.resource?.volume) {
      player.resource.volume.setVolume(player.volume / 100);
    }

    if (player.textChannel) {
      try {
        // 새 CV2 현재 재생 메시지 전송 (진행 갱신도 시작). 옛 패널은 기록을 보고 치운다. 복구에는 진입점 자리표시자가 없다.
        const requester = { id: session.requesterId || player.guild.client.user.id };
        await playerEvents.started(player, requester);
      } catch (error) {
        log.error("세션 복원 중 재생 임베드 복구 실패:", error?.message || error);
      }
    }

    if (player.currentTrack) {
      try {
        await playerEvents.notice(player, "restored", { title: player.currentTrack.title, atSec: Math.floor(resumeMs / 1000), paused: player.paused });
      } catch {
        // 메시지를 보낼 수 없으면 무시
      }
    }

    this.scheduleStatePersist("restored", 1000);
  }
}

export default SessionPersistence;
export { SessionPersistence as "module.exports" };
SessionPersistence._beat = beat;
