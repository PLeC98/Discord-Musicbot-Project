import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "session" });
import { stateDb } from "../store/state-db.ts";
import { sessions } from "../store/player-sessions.ts";
import * as trackState from "./track-state.ts";
import config from "../config/index.ts";
import * as playerEvents from "./events.ts";
import { codeOf, messageOf, codedError } from "../rules/error-kind.ts";
import type { Player } from "./player.ts";
import type { QueuedTrack } from "./track.ts";
import type { PlayerSessionStore, RestoredTrack, RestoredSession } from "../store/player-sessions.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import * as audioCache from "../store/audio-cache.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";

const POSITION_SAVE_MS = 5000;
// 설정이 바뀐 뒤 이만큼 모았다가 한 번 쓴다(볼륨을 연달아 바꾸는 따위)
const SETTINGS_SETTLE_MS = 200;

// 저장한 직후 메모리를 비우는 경로다. 미러를 붙인 채 비우면 방금 저장한 곡이 DB에서 삭제된다.
const FINAL_REASONS = new Set(["leave", "shutdown"]);

// 기동이 DB를 연 뒤에만 쓴다. DB를 열지 않은 채 플레이어를 만드는 테스트가 실제 DB 파일을 건드리지 않게.
const liveStore = () => (stateDb.isOpen() ? sessions() : null);

// 재생 위치는 플레이어마다 타이머를 두지 않고 하나로 모아 한 트랜잭션에 쓴다.
const active = new Set<SessionPersistence>();
let tickTimer: NodeJS.Timeout | null = null;
// DB 가 잠기면 5초마다 같은 실패가 난다. 처음 한 번만 error, 풀리면 한 줄
const positionSave = repeatingFailure(log, "재생 위치 저장");

function saveTick() {
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
  static _saveTick = saveTick;
  player: Player;
  frozen: boolean;
  dirty: boolean;
  /** 지난번에 쓴 세션 행(위치 뺀 열). 설정 알림과 주기 저장이 이것과 비교한다 */
  lastRow: string | null;
  settingsTimer: NodeJS.Timeout | null = null;
  /** 그 서버의 저장된 세션이 이 플레이어의 것인가(복원했거나, 앞 플레이어가 남긴 것을 지우고 새로 쓰기 시작했다) */
  claimed = false;

  // 알림(events)에 플레이어를 넘기므로 플레이어 그대로 받는다
  constructor(player: Player) {
    this.player = player;
    this.frozen = false; // 마지막 저장 뒤. 이후의 트랙 변경은 DB에 옮기지 않는다
    this.dirty = false; // 증분 쓰기가 실패해 DB가 메모리와 어긋났을 수 있다
    this.lastRow = null;
  }

  /**
   * 앞 플레이어가 남긴 세션(/leave, 음성 복구 포기 등)을 지우고 이 플레이어의 것으로 삼는다. 지운 곡 중 사람이 넣은 곡 수.
   * 새 플레이어의 증분 쓰기는 옛 행 위에 얹혀 메모리와 어긋나므로 첫 쓰기 전에 부른다. 이어 듣기는 /join 이 복원으로 한다
   */
  claimSaved(): number {
    if (this.claimed) return 0;
    this.claimed = true;
    const store = liveStore();
    const guildId = this.player.guild?.id;
    if (!store || !guildId) return 0;
    try {
      const saved = store.load(guildId);
      if (!saved) return 0;
      const botId = this.player.guild?.client?.user?.id ?? null;
      const human = [saved.current, ...saved.queue].filter((t) => t && t.requesterId !== botId).length;
      store.removeSession(guildId);
      log.info(`저장된 세션을 삭제하고 새로 시작: 사람이 추가한 곡 ${human}곡 (서버 ID ${guildId})`);
      return human;
    } catch (error) {
      log.error(`저장된 세션 정리 실패 (서버 ID ${guildId}):`, messageOf(error));
      return 0;
    }
  }

  // ── 곡 미러 (trackState가 부른다) ──

  // clearing: 비우기만 하는 쓰기(버릴 때의 reset). 아직 세션을 넘겨받지 않은 플레이어가 비우는 것은 남의 세션이라 건드리지 않는다
  _mirror(write: (store: PlayerSessionStore, guildId: string) => boolean | void, { clearing = false }: { clearing?: boolean } = {}) {
    const guildId = this.player.guild?.id;
    const store = liveStore();
    if (this.frozen || !guildId || !store) return;
    if (!this.claimed) {
      if (clearing) return;
      this.claimSaved();
    }
    if (this.dirty) return this.resync(store);
    try {
      // 옮길 행이 없었다 = 이미 어긋나 있었다
      if (write(store, guildId) === false) this.resync(store);
    } catch (error) {
      this.dirty = true;
      log.warn(`세션 곡 저장 실패(다음 변경에서 통째로 다시 씀, 서버 ID ${guildId}): ${messageOf(error)}`);
    }
  }

  resync(store: PlayerSessionStore | null = liveStore()) {
    const p = this.player;
    if (this.frozen || !store || !p.guild?.id) return;
    this.claimSaved();
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
    this._mirror((s, g) => s.reset(g, { history }), { clearing: true });
  }

  onReplace() {
    this.resync();
  }

  /** 곡의 필드(제목, 가수, 앨범, 표시 길이)를 그 자리에서 고쳤다(다운로드, 파일 태그). 사본은 다음 쓰기, 주기 저장에서 통째로 다시 쓴다 */
  onTrackInfo() {
    this.dirty = true;
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
      // 저장하는 건 사람의 뜻뿐이다(억제로 소리가 이미 멈춰 있어도). 억제 사유는 복원한 뒤 지금 음성 상태에서 다시 계산한다
      userPaused: p.pause.userPaused,
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

  /** 세션 행 열(볼륨, 반복, 수동 멈춤 등)이 지난 저장과 다르면 쓴다. 설정 알림이 부르고, 주기 저장이 알림을 빠뜨린 길을 잡는다 */
  saveRowIfChanged() {
    const p = this.player;
    if (!p.currentTrack && p.queue.length === 0) return;
    if (this._rowKey() !== this.lastRow) bestEffort(log, this.save("changed"), "세션 저장");
  }

  // 세션 행에서 위치를 뺀 열. 위치는 주기 저장이 따로 쓴다
  _rowKey() {
    const { positionMs: _position, ...row } = this.sessionFields();
    return JSON.stringify(row);
  }

  /**
   * 지금 위치만 쓴다(멈출 때, 스트림 휴면에 들어갈 때. 주기 저장은 멈춘 플레이어를 건너뛴다).
   * 주기 저장에 든(재생을 시작한) 플레이어이고 세션을 넘겨받았을 때만. 복원은 주기 저장에서 뺀 뒤 멈춤을 맞춰, 위치를 맞추기 전에 쓰지 않는다
   */
  savePosition() {
    const store = liveStore();
    const p = this.player;
    if (!store || this.frozen || !active.has(this) || !this.claimed || !p.guild?.id || !p.currentTrack) return;
    try {
      store.savePositions([{ guildId: p.guild.id, positionMs: p.getCurrentTime() || 0 }]);
    } catch (error) {
      log.warn(`재생 위치 저장 실패: ${messageOf(error)}`);
    }
  }

  /** 세션 행을 곧바로 쓴다. saveNow 와 같고 Promise 를 돌려준다: 기다리는 곳(종료, bestEffort)과 테스트가 차례를 끼우는 곳이 쓴다 */
  async save(reason: string) {
    this.saveNow(reason);
  }

  /** 세션 행을 곧바로 쓴다(DB 쓰기는 동기다). 기다릴 수 없는 곳(치명 종료)이 부른다. reason 이 나감, 종료면 이 뒤로는 옮기지 않는다 */
  saveNow(reason: string) {
    const p = this.player;
    const store = liveStore();
    if (this.frozen || !p.guild?.id || !store) return;
    try {
      if (!p.currentTrack && p.queue.length === 0) {
        // 넘겨받지 않은 세션은 남의 것이다(앞 플레이어가 남긴 것). 틀 곡이 없는 이 플레이어가 지우지 않는다
        if (this.claimed) store.removeSession(p.guild.id);
        this.lastRow = null;
      } else {
        this.claimSaved();
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
    // 넘겨받지 않은 세션은 앞 플레이어가 남긴 것이다. /join 이 복원할 수 있게 둔다
    if (!store || !guildId || !this.claimed) return;
    try {
      store.removeSession(guildId);
      this.lastRow = null;
    } catch (error) {
      log.error(`세션 삭제 실패 (서버 ID ${guildId}):`, messageOf(error));
    }
  }

  startPeriodicSave() {
    active.add(this);
    if (!tickTimer) {
      tickTimer = setInterval(saveTick, POSITION_SAVE_MS);
      tickTimer.unref?.();
    }
  }

  stopPeriodicSave() {
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    active.delete(this);
    if (active.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  // ── 복원 ──

  reviveTrack(data: RestoredTrack | null): QueuedTrack | null {
    if (!data) return null;
    const { requesterId, id, title, duration, platform, artist, album, entry, ...rest } = data;
    // 행은 빈 열을 null 로 준다. 곡의 타입에 맞춘다(없는 필드는 비우고, 꼭 있어야 하는 필드는 빈 값)
    const track: QueuedTrack = { ...rest, id: id ?? undefined, title: title ?? "", duration: duration ?? 0, platform: platform ?? "", artist: artist ?? undefined, album: album ?? undefined };
    // 요청자는 권한 판정과 멘션에 id만 쓰인다
    if (requesterId) track.requestedBy = { id: requesterId };
    // 대기열 ID는 다시 시작하기 전과 같게(track-state 가 찍는 것과 같은 열거되지 않는 필드). 없으면 track-state 가 추가할 때 새로 찍는다
    if (entry) Object.defineProperty(track, "entry", { value: entry, enumerable: false });
    return track;
  }

  /**
   * 저장한 세션을 복원해 이어 튼다. 무엇이 됐나: restored 이어 틂, failed 틀 곡을 열지 못함(남은 곡은 대기열에), empty 틀 곡이 없음.
   * announce 를 끄면 텍스트 채널에 복원했다고 알리지 않고, 연달아 실패해 멈춘 것도 알리지 않는다(/join 이 명령 응답으로 말한다)
   */
  async restoreFromState(record: RestoredSession | null | undefined, { announce = true }: { announce?: boolean } = {}): Promise<"restored" | "parked" | "failed" | "empty"> {
    const player = this.player;
    if (!record || !player.guild?.id) return "empty";
    const { session } = record;
    this.claimed = true; // 저장된 세션을 이 플레이어로 되살린다
    this.stopPeriodicSave();
    player.restoreSettings({
      volume: session.volume,
      loop: session.loopMode === "track" || session.loopMode === "queue" ? session.loopMode : false,
      autoplay: session.autoplay || false,
      userPaused: Boolean(session.userPaused),
    });

    this._restoreTracks(record, player.guild.id);
    // 지금 곡 없이 대기열만 저장됐다(곡 기록이 DB 에 닿지 못한 채 꺼졌다). 첫 곡을 지금 곡으로 올리되 저절로 틀지 않는다(멈춘 채 연다)
    if (!player.currentTrack && player.queue.length > 0) {
      trackState.shiftNext(player);
      player.pause.setUser(true);
    }
    let resumeMs = resumeAt(player.currentTrack, session.positionMs);
    // 저장 위치가 곡 끝이었다. 다 들은 곡을 처음부터 다시 틀지 않고, 곡이 끝났을 때와 같이 다음 곡으로
    if (endedAt(player.currentTrack, session.positionMs)) {
      resumeMs = 0;
      await this._advancePastEnd();
    }
    player.heldPositionMs = resumeMs;

    // 틀 곡이 없으면 붙지 않는다(붙은 채 나갈 타이머 없이 남지 않게)
    if (!player.currentTrack) {
      this.removeSession();
      return "empty";
    }

    await this._reconnect();
    // 이미 붙어 있었으면 붙기가 맞추지 않으므로 여기서 맞춘다(겹쳐 불러도 같다)
    player.syncHolds();

    player.quietFailures = !announce;
    try {
      await player.play(resumeMs, { continued: true });
    } finally {
      player.quietFailures = false;
    }
    if (!player.currentTrack) return "failed";
    // 열지 못해 그 곡에서 일시정지해 뒀다. 이어 튼다고 알리지 않는다(까닭은 일시정지해 둘 때의 알림, /join 응답이 말한다). 패널은 일시정지한 곡으로
    if (player.lifecycle.parked) {
      await this._announceRestored(false);
      return "parked";
    }

    await this._announceRestored(announce);
    return "restored";
  }

  // 저장 위치가 곡 끝이었다. 곡이 끝났을 때와 같이 간다: 한 곡 반복이면 그 곡을 처음부터, 대기열 반복이면 맨 뒤로, 아니면 기록으로 보내고 다음 곡,
  // 대기열이 비었으면 자동재생 곡을 하나 골라 넣고, 그것도 없으면 지금 곡을 비운다(틀 곡 없음). 끝 처리(_playNext)는 아직 없는 패널을 고치려 하므로 단계만 쓴다
  async _advancePastEnd() {
    const player = this.player;
    const finished = player.currentTrack;
    if (!finished || player.loop === "track") return;
    trackState.retire(player, finished, { requeue: player.loop === "queue" });
    if (player.queue.length === 0 && player.autoplay) {
      // pickAutoplayTrack 이 실패를 error 로 남기고 null 을 돌려준다. 여기서는 예외를 던지지 않게만 한다
      const picked = await player.pickAutoplayTrack().catch(() => null);
      if (picked) trackState.enqueue(player, [picked]);
    }
    if (player.queue.length > 0) trackState.shiftNext(player);
    else trackState.setCurrent(player, null);
  }

  // 저장된 곡을 메모리에 올린다
  _restoreTracks(record: RestoredSession, guildId: string) {
    const player = this.player;
    // 미리 선택해 둔 자동재생 곡은 복원하지 않는다. 사용자가 선택한 곡만 세션에 남는 것이 자연스럽고,
    // 장르는 함께 복원되므로 첫 곡이 시작될 때 다시 선택된다. 요청자가 봇인 것으로 구분한다.
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
      // 잘랐거나 필터링했으면 메모리와 DB가 어긋난다. 다시 써서 맞춘다
      { persisted: !cut && droppedAutoplay === 0 },
    );
  }

  async _reconnect() {
    if (this.player.connection) return;
    try {
      await this.player.voice.connect();
    } catch (error) {
      // 종료 중이라 붙지 않았다. 연결 실패가 아니므로 그대로 던진다(부른 쪽이 세션을 남기고 정리한다)
      if (codeOf(error) === "bot-shutting-down") throw error;
      log.error("세션 복원 중 음성 연결 실패:", messageOf(error));
      throw codedError("voice-failed", "음성 채널 재연결 실패", { cause: error });
    }
  }

  // 패널을 다시 세운다. announce 면 이어 튼다고 텍스트 채널에 알린다
  async _announceRestored(announce: boolean) {
    const player = this.player;
    if (player.textChannel) {
      try {
        // 재생 패널을 새로 올린다(진행 갱신도 시작). 옛 패널은 기록을 보고 치운다. 복원에는 진입점 자리표시자가 없다.
        await playerEvents.started(player);
      } catch (error) {
        log.error("세션 복원 중 재생 임베드 복구 실패:", messageOf(error));
      }
    }

    if (announce && player.currentTrack) {
      try {
        // 실제로 튼 곡과 위치(복원하던 곡을 곡 탓으로 넘겼으면 다른 곡, 처음부터다)
        await playerEvents.notice(player, "restored", { title: player.currentTrack.title, atSec: Math.floor(player.getCurrentTime() / 1000), paused: player.pause.userPaused });
      } catch (error) {
        log.warn(`복원 알림 보내기 실패: ${messageOf(error)}`);
      }
    }
  }
}

// 이어 틀 위치. 라이브에 저장된 위치는 의미가 없다(어차피 지금 시점, 라이브 엣지로만 붙는다)
function resumeAt(track: QueuedTrack | null, positionMs: number | null | undefined) {
  return track?.isLive ? 0 : Math.max(0, Number(positionMs) || 0);
}

/**
 * 저장 위치가 곡 끝인가: 위치 + 주기 저장 간격 ≥ 곡 길이. 위치는 5초마다 쓰므로 비정상 종료면 실제보다 최대 그만큼 늦다(그 안쪽이면 이미 끝났을 수 있다).
 * 길이는 캐시에 잰 오디오 길이를 먼저(스포티파이 곡은 표시 길이를 지키는데 받은 음원이 더 길 수 있다), 없으면 표시 길이. 길이를 모르거나 라이브면 아니다
 */
function endedAt(track: QueuedTrack | null, positionMs: number | null | undefined) {
  if (!track || track.isLive) return false;
  const key = audioKeyOf(track.audioUrl);
  const measured = key ? audioCache.lookupByAudioKey(key)?.duration_sec : null;
  const lengthMs = (measured && measured > 0 ? measured : Number(track.duration) || 0) * 1000;
  return lengthMs > 0 && Math.max(0, Number(positionMs) || 0) + POSITION_SAVE_MS >= lengthMs;
}

export { SessionPersistence };
