import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "session" });
import { stateDb } from "../store/state-db.ts";
import { sessions } from "../store/player-sessions.ts";
import * as trackState from "./track-state.ts";
import config from "../config/index.ts";
import * as playerEvents from "./events.ts";
import { messageOf, codedError } from "../rules/error-kind.ts";
import type { Player } from "./player.ts";
import type { QueuedTrack } from "./track.ts";
import type { PlayerSessionStore, RestoredTrack, RestoredSession } from "../store/player-sessions.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";

const HEARTBEAT_MS = 5000;
// 설정이 바뀐 뒤 이만큼 모았다가 한 번 쓴다(음량을 연달아 바꾸는 따위)
const SETTINGS_SETTLE_MS = 200;

// 저장한 직후 메모리를 비우는 경로다. 거울을 붙인 채 비우면 방금 저장한 트랙이 DB에서 지워진다.
const FINAL_REASONS = new Set(["leave", "shutdown"]);

// 기동이 DB를 연 뒤에만 쓴다. DB를 열지 않은 채 플레이어를 만드는 테스트가 실제 DB 파일을 건드리지 않게.
const liveStore = () => (stateDb.isOpen() ? sessions() : null);

// 재생 위치는 플레이어마다 타이머를 두지 않고 하나로 모아 한 트랜잭션에 쓴다.
const active = new Set<SessionPersistence>();
let heartbeat: NodeJS.Timeout | null = null;
// DB 가 잠기면 5초마다 같은 실패가 난다. 처음 한 번만 error, 풀리면 한 줄
const positionSave = repeatingFailure(log, "재생 위치 저장");

function beat() {
  const store = liveStore();
  if (!store) return;
  const entries: Array<{ guildId: string; positionMs: number }> = [];
  for (const sp of active) {
    const p = sp.player;
    if (sp.frozen || !p.guild?.id) continue;
    sp.saveRowIfChanged();
    if (!p.currentTrack || p.paused) continue;
    if (sp.dirty) sp.resync(store);
    entries.push({ guildId: p.guild.id, positionMs: p.getCurrentTime() || 0 });
  }
  if (entries.length === 0) return;
  try {
    store.savePositions(entries);
    positionSave.ok();
  } catch (error) {
    positionSave.fail(messageOf(error));
  }
}

class SessionPersistence {
  static _beat = beat;
  player: Player;
  frozen: boolean;
  dirty: boolean;
  /** 지난번에 쓴 세션 행(위치 뺀 칸). 설정 알림과 주기 저장이 이것과 비교한다 */
  lastRow: string | null;
  settingsTimer: NodeJS.Timeout | null = null;

  // 알림(events)에 플레이어를 넘기므로 플레이어 그대로 받는다
  constructor(player: Player) {
    this.player = player;
    this.frozen = false; // 마지막 저장 뒤. 이후의 트랙 변경은 DB에 옮기지 않는다
    this.dirty = false; // 증분 쓰기가 실패해 DB가 메모리와 어긋났을 수 있다
    this.lastRow = null;
  }

  // ── 트랙 거울 (trackState가 부른다) ──

  _mirror(write: (store: PlayerSessionStore, guildId: string) => boolean | void) {
    const guildId = this.player.guild?.id;
    const store = liveStore();
    if (this.frozen || !guildId || !store) return;
    if (this.dirty) return this.resync(store);
    try {
      // 옮길 행이 없었다 = 이미 어긋나 있었다
      if (write(store, guildId) === false) this.resync(store);
    } catch (error) {
      this.dirty = true;
      log.warn(`세션 트랙 저장 실패. 다음 변경에서 통째로 다시 씁니다 (서버 ID ${guildId}): ${messageOf(error)}`);
    }
  }

  resync(store: PlayerSessionStore | null = liveStore()) {
    const p = this.player;
    if (this.frozen || !store || !p.guild?.id) return;
    try {
      store.replaceTracks(p.guild.id, { current: p.currentTrack, queue: p.queue, history: p.previousTracks });
      this.dirty = false;
    } catch (error) {
      this.dirty = true;
      log.error(`세션 트랙 재기록 실패 (서버 ID ${p.guild.id}): ${messageOf(error)}`);
    }
  }

  onSetCurrent(track: QueuedTrack | null) {
    this._mirror((s, g) => s.setCurrent(g, track));
  }

  onEnqueue(tracks: QueuedTrack[], front: boolean) {
    this._mirror((s, g) => s.append(g, tracks, { front }));
  }

  onTake(index: number) {
    this._mirror((s, g) => s.take(g, index));
  }

  onRetire(track: QueuedTrack, requeue: boolean) {
    this._mirror((s, g) => s.retire(g, track, { requeue }));
  }

  onRewind(track: QueuedTrack, copy: number, current: QueuedTrack | null, fromHistory: boolean) {
    this._mirror((s, g) => s.rewind(g, track, { copy, current, fromHistory }));
  }

  onRemoveAt(index: number) {
    this._mirror((s, g) => s.removeAt(g, index));
  }

  onMove(from: number, to: number) {
    this._mirror((s, g) => s.move(g, from, to));
  }

  onClearQueue() {
    this._mirror((s, g) => s.clearQueue(g));
  }

  onReset(history: boolean) {
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
      loopMode: p.loop === "track" || p.loop === "queue" ? p.loop : ("off" as const),
      autoplay: p.autoplay || null,
      // 복원하는 건 수동 일시정지뿐이다. 혼자 남음 같은 사유는 복원 시점의 상황이 다시 건다
      pausedManual: Boolean(p.paused) && Boolean(p.pauseReasons?.has("manual")),
      // 곡 안의 절대 위치(시작 위치를 더한 값)라 복원할 때 이것만 본다
      positionMs: p.getCurrentTime?.() || 0,
    };
  }

  /** 설정이 바뀌었다(플레이어가 알린다). 잠깐 모았다가 세션 행이 지난 저장과 다르면 쓴다. 동기화 중(재생을 시작한 뒤 버리기 전)에만 */
  onSettingsChanged() {
    if (this.settingsTimer || !active.has(this)) return;
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null;
      this.saveRowIfChanged();
    }, SETTINGS_SETTLE_MS);
    this.settingsTimer.unref?.();
  }

  /** 세션 행 칸(음량 · 반복 · 수동 멈춤 등)이 지난 저장과 다르면 쓴다. 설정 알림이 부르고, 주기 저장이 알림을 빠뜨린 길을 잡는다 */
  saveRowIfChanged() {
    const p = this.player;
    if (!p.currentTrack && p.queue.length === 0) return;
    if (this._rowKey() !== this.lastRow) bestEffort(log, this.persistState("changed"), "세션 저장");
  }

  // 세션 행에서 위치를 뺀 칸. 위치는 주기 저장이 따로 쓴다
  _rowKey() {
    const { positionMs: _position, ...row } = this.sessionFields();
    return JSON.stringify(row);
  }

  async persistState(reason = "manual") {
    this.saveNow(reason);
  }

  /** 세션 행을 곧바로 쓴다(DB 쓰기는 동기다). 기다릴 수 없는 곳(치명 종료)이 부른다 */
  saveNow(reason: string) {
    const p = this.player;
    const store = liveStore();
    if (this.frozen || !p.guild?.id || !store) return;
    try {
      if (!p.currentTrack && p.queue.length === 0) {
        store.removeSession(p.guild.id);
        this.lastRow = null;
      } else {
        if (this.dirty) this.resync(store);
        store.saveSession(p.guild.id, this.sessionFields());
        this.lastRow = this._rowKey();
      }
    } catch (error) {
      log.error(`세션 저장 실패 (서버 ID ${p.guild.id}):`, messageOf(error));
    }
    if (FINAL_REASONS.has(reason)) this.frozen = true;
  }

  removeSession() {
    const store = liveStore();
    const guildId = this.player.guild?.id;
    if (!store || !guildId) return;
    try {
      store.removeSession(guildId);
      this.lastRow = null;
    } catch (error) {
      log.error(`세션 삭제 실패 (서버 ID ${guildId}):`, messageOf(error));
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
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    active.delete(this);
    if (active.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  // ── 복원 ──

  reviveTrack(data: RestoredTrack | null): QueuedTrack | null {
    if (!data) return null;
    const { requesterId, id, title, duration, platform, artist, album, entry, ...rest } = data;
    // 행은 빈 칸을 null 로 준다. 트랙의 모양으로 맞춘다(없는 칸은 비우고, 꼭 있어야 하는 칸은 빈 값)
    const track: QueuedTrack = { ...rest, id: id ?? undefined, title: title ?? "", duration: duration ?? 0, platform: platform ?? "", artist: artist ?? undefined, album: album ?? undefined };
    // 요청자는 권한 판정과 멘션에 id만 쓰인다
    if (requesterId) track.requestedBy = { id: requesterId };
    // 줄 번호는 다시 켜기 전과 같게(track-state 가 찍는 것과 같은 열거되지 않는 칸). 없으면 track-state 가 들일 때 새로 찍는다
    if (entry) Object.defineProperty(track, "entry", { value: entry, enumerable: false });
    return track;
  }

  /**
   * 저장한 세션을 복원해 이어 튼다. 무엇이 됐나: restored 이어 틂 · failed 틀 곡을 열지 못함(남은 곡은 대기열에) · empty 틀 곡이 없음.
   * announce 를 끄면 글자 채널에 복원했다고 알리지 않고, 연달아 실패해 멈춘 것도 알리지 않는다(/join 이 명령 응답으로 말한다)
   */
  async restoreFromState(record: RestoredSession | null | undefined, { announce = true }: { announce?: boolean } = {}): Promise<"restored" | "failed" | "empty"> {
    const player = this.player;
    if (!record || !player.guild?.id) return "empty";
    const { session } = record;
    this.stopStateSync();
    player.restoreSettings({
      volume: session.volume,
      loop: session.loopMode === "track" || session.loopMode === "queue" ? session.loopMode : false,
      autoplay: session.autoplay || false,
    });

    this._restoreTracks(record, player.guild.id);
    const resumeMs = resumeAt(player.currentTrack, session.positionMs);
    player.lastPlaybackPosition = resumeMs;
    player.paused = false;

    await this._reconnect();

    if (!player.currentTrack) {
      this.removeSession();
      return "empty";
    }

    if (session.pausedManual) player.pauseReasons.add("manual"); // play()가 시작 직후 즉시 일시정지

    player.quietFailures = !announce;
    try {
      await player.play(resumeMs, { continued: true });
    } finally {
      player.quietFailures = false;
    }
    if (!player.currentTrack) return "failed";
    if (session.pausedManual) player.pauseFor("manual"); // paused 플래그 동기화 (UI/직렬화 일관성)

    if (player.resource?.volume) {
      player.resource.volume.setVolume(player.volume / 100);
    }

    await this._announceRestored(resumeMs, announce);
    return "restored";
  }

  // 저장된 트랙을 메모리에 올린다
  _restoreTracks(record: RestoredSession, guildId: string) {
    const player = this.player;
    // 미리 뽑아 둔 자동재생 곡은 복원하지 않는다. 사용자가 고른 곡만 세션에 남는 것이 자연스럽고,
    // 장르는 함께 복원되므로 첫 곡이 시작될 때 다시 뽑힌다. 요청자가 봇인 것으로 가른다.
    const botId = player.guild?.client?.user?.id || null;
    const queueRows = botId ? record.queue.filter((t) => t.requesterId !== botId) : record.queue;
    const droppedAutoplay = record.queue.length - queueRows.length;
    if (droppedAutoplay > 0) log.info(`복원에서 자동재생 곡 ${droppedAutoplay}곡 제외 (서버 ID ${guildId})`);

    // 상한을 줄인 뒤 재시작하면 저장된 대기열이 넘친다. 잘라낸다. 잘랐으면 DB도 맞춰야 하니 다시 쓴다.
    const max = config.bot.maxQueueSize;
    const cut = max > 0 && queueRows.length > max;
    if (cut) log.info(`복원한 대기열이 상한을 넘어 잘라냄: ${queueRows.length}곡 → ${max}곡 (서버 ID ${guildId})`);
    trackState.restore(
      player,
      {
        current: this.reviveTrack(record.current),
        queue: (cut ? queueRows.slice(0, max) : queueRows).flatMap((t) => this.reviveTrack(t) ?? []),
        history: record.history.flatMap((t) => this.reviveTrack(t) ?? []),
      },
      // 잘랐거나 걸러냈으면 메모리와 DB가 어긋난다. 다시 써서 맞춘다
      { persisted: !cut && droppedAutoplay === 0 },
    );

    if (!player.currentTrack && player.queue.length > 0) {
      trackState.shiftNext(player);
    }
  }

  async _reconnect() {
    if (this.player.connection) return;
    try {
      await this.player.voice.connect();
    } catch (error) {
      log.error("세션 복원 중 음성 연결 실패:", messageOf(error));
      throw codedError("voice-failed", "음성 채널에 다시 연결하지 못했습니다", { cause: error });
    }
  }

  // 패널을 다시 세운다. announce 면 이어 튼다고 글자 채널에 알린다
  async _announceRestored(resumeMs: number, announce: boolean) {
    const player = this.player;
    if (player.textChannel) {
      try {
        // 새 CV2 현재 재생 메시지 전송 (진행 갱신도 시작). 옛 패널은 기록을 보고 치운다. 복구에는 진입점 자리표시자가 없다.
        await playerEvents.started(player);
      } catch (error) {
        log.error("세션 복원 중 재생 임베드 복구 실패:", messageOf(error));
      }
    }

    if (announce && player.currentTrack) {
      try {
        await playerEvents.notice(player, "restored", { title: player.currentTrack.title, atSec: Math.floor(resumeMs / 1000), paused: player.paused });
      } catch {
        // 메시지를 보낼 수 없으면 무시
      }
    }
  }
}

// 이어 틀 위치. 끝나기 직전이었으면 처음부터
function resumeAt(track: QueuedTrack | null, positionMs: number | null | undefined) {
  // 라이브에 저장된 위치는 의미가 없다. 어차피 지금 시점(라이브 엣지)으로만 붙는다.
  if (track?.isLive) return 0;
  const trackDurationMs = track?.duration ? Number(track.duration) * 1000 : null;
  const resumeMs = Math.max(0, Number(positionMs) || 0);
  return trackDurationMs && resumeMs > Math.max(trackDurationMs - 2000, 0) ? 0 : resumeMs;
}

export { SessionPersistence };
