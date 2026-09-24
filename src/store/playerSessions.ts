// 플레이어 세션 저장소. 길드당 세션 한 행 + 현재곡·대기열·기록 트랙 행.
// DB는 재시작 복원용 사본이다. 재생 중의 진실은 메모리 배열이고, 슬롯 안의 행 순서는 그 배열 순서와 같다.
// 그래서 i번째 곡은 seq를 들고 다니지 않고 `ORDER BY seq LIMIT 1 OFFSET i`로 찾는다.

import { HISTORY_MAX } from "../rules/history.ts";
import * as db from "./db.ts";
import type { Db } from "./db.ts";
import { SessionTrackRow, checked } from "./rows.ts";
import type { SessionTrackRow as TrackRow } from "./rows.ts";

// 끼워넣을 때 양옆의 중간값을 쓰므로 간격이 클수록 재번호 없이 오래 버틴다
const GAP = 1_000_000_000;
// better-sqlite3는 정수를 JS Number로 준다. 2^53을 넘으면 정밀도가 깨지므로 그 전에 재번호한다
const SEQ_LIMIT = Number.MAX_SAFE_INTEGER - GAP;

const TRACK_COLUMNS = ["track_id", "page_url", "request_key", "audio_url", "title", "artist", "album", "uploader", "duration_sec", "thumbnail", "platform", "is_live", "requester_id", "added_at"] as const;

type Slot = "current" | "queue" | "history";
type LoopMode = "off" | "track" | "queue";

/** 저장할 곡. 대기열의 곡에 되읽은 곡의 칸(requesterId · uploader)이 섞여 온다. 여기서 읽는 칸만 */
type TrackIn = {
  id?: string | null;
  pageUrl?: string | null;
  requestKey?: string | null;
  audioUrl?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  uploader?: string | null;
  duration?: unknown;
  thumbnail?: string | null;
  platform?: string | null;
  isLive?: boolean | null;
  live?: boolean | null;
  requestedBy?: { id?: string | null } | null;
  requesterId?: string | null;
  addedAt?: number | null;
};

/** player_sessions 한 줄 */
type SessionRow = {
  guild_id: string;
  voice_channel_id: string | null;
  text_channel_id: string | null;
  volume: number;
  loop_mode: LoopMode;
  autoplay: string | null;
  paused_manual: number;
  position_ms: number;
  start_offset_ms: number;
  requester_id: string | null;
  updated_at: number;
};

/** 세션 한 벌(트랙 말고). 저장할 때는 빠진 칸을 기본값으로 */
type SessionState = {
  voiceChannelId?: string | null;
  textChannelId?: string | null;
  volume?: number;
  loopMode?: LoopMode;
  autoplay?: string | null;
  pausedManual?: boolean;
  positionMs?: number;
  startOffsetMs?: number;
  requesterId?: string | null;
};

// 되읽은 트랙 줄. 모양을 보기 전이라 칸은 모른다(슬롯은 표의 CHECK 가 지킨다)
type RawTrackRow = { guild_id: string; slot: Slot; seq: number; [column: string]: unknown };
type TrackParams = ReturnType<typeof toRow>;

// 빈 값(undefined · null · "")은 NULL 로
const orNull = <T>(value: T | null | undefined) => value || null;

function toRow(track: TrackIn) {
  return {
    track_id: orNull(track.id),
    page_url: orNull(track.pageUrl),
    request_key: orNull(track.requestKey),
    audio_url: orNull(track.audioUrl),
    title: orNull(track.title),
    artist: orNull(track.artist),
    album: orNull(track.album),
    uploader: orNull(track.uploader),
    duration_sec: typeof track.duration === "number" ? track.duration : Number(track.duration) || null,
    thumbnail: orNull(track.thumbnail),
    platform: orNull(track.platform),
    is_live: track.isLive || track.live ? 1 : 0,
    requester_id: track.requestedBy?.id || orNull(track.requesterId),
    added_at: track.addedAt || Date.now(),
  };
}

function fromRow(row: TrackRow) {
  return {
    id: row.track_id,
    title: row.title,
    pageUrl: row.page_url,
    requestKey: row.request_key,
    audioUrl: row.audio_url ?? undefined,
    // 저장하지 않고 되읽을 때 가린다. 요청과 다른 음원은 장부에서 온 것과 같은 처지다(내려갔으면 다시 찾는다)
    audioFoundBy: row.audio_url ? (row.audio_url === row.request_key ? ("given" as const) : ("ledger" as const)) : undefined,
    duration: row.duration_sec,
    thumbnail: row.thumbnail,
    artist: row.artist,
    album: row.album,
    uploader: row.uploader,
    platform: row.platform,
    isLive: Boolean(row.is_live),
    addedAt: row.added_at,
    requesterId: row.requester_id,
  };
}

function sessionFromRow(row: SessionRow) {
  return {
    voiceChannelId: row.voice_channel_id,
    textChannelId: row.text_channel_id,
    volume: row.volume,
    loopMode: row.loop_mode,
    autoplay: row.autoplay,
    pausedManual: Boolean(row.paused_manual),
    positionMs: row.position_ms,
    startOffsetMs: row.start_offset_ms,
    requesterId: row.requester_id,
    updatedAt: row.updated_at,
  };
}

function queries(conn: Db) {
  const cols = TRACK_COLUMNS.join(", ");
  const params = TRACK_COLUMNS.map((c) => `@${c}`).join(", ");
  return {
    ensure: conn.prepare<[string, number]>("INSERT OR IGNORE INTO player_sessions (guild_id, updated_at) VALUES (?, ?)"),
    upsert: conn.prepare<SessionRow>(`
        INSERT INTO player_sessions (guild_id, voice_channel_id, text_channel_id, volume, loop_mode, autoplay,
                                     paused_manual, position_ms, start_offset_ms, requester_id, updated_at)
        VALUES (@guild_id, @voice_channel_id, @text_channel_id, @volume, @loop_mode, @autoplay,
                @paused_manual, @position_ms, @start_offset_ms, @requester_id, @updated_at)
        ON CONFLICT(guild_id) DO UPDATE SET
          voice_channel_id = excluded.voice_channel_id, text_channel_id = excluded.text_channel_id,
          volume = excluded.volume, loop_mode = excluded.loop_mode, autoplay = excluded.autoplay,
          paused_manual = excluded.paused_manual, position_ms = excluded.position_ms, start_offset_ms = excluded.start_offset_ms,
          requester_id = excluded.requester_id, updated_at = excluded.updated_at`),
    position: conn.prepare<[number, number, number, string]>("UPDATE player_sessions SET position_ms = ?, start_offset_ms = ?, updated_at = ? WHERE guild_id = ?"),
    deleteSession: conn.prepare<[string]>("DELETE FROM player_sessions WHERE guild_id = ?"),
    deleteGuildTracks: conn.prepare<[string]>("DELETE FROM session_tracks WHERE guild_id = ?"),
    insert: conn.prepare<TrackParams & { guild_id: string; slot: Slot; seq: number }>(`INSERT INTO session_tracks (guild_id, slot, seq, ${cols}) VALUES (@guild_id, @slot, @seq, ${params})`),
    minSeq: conn.prepare<[string, Slot], { v: number | null }>("SELECT MIN(seq) AS v FROM session_tracks WHERE guild_id = ? AND slot = ?"),
    maxSeq: conn.prepare<[string, Slot], { v: number | null }>("SELECT MAX(seq) AS v FROM session_tracks WHERE guild_id = ? AND slot = ?"),
    count: conn.prepare<[string, Slot], { n: number }>("SELECT COUNT(*) AS n FROM session_tracks WHERE guild_id = ? AND slot = ?"),
    rowidAt: conn.prepare<[string, Slot, number], { rowid: number }>("SELECT rowid FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq LIMIT 1 OFFSET ?"),
    lastRowid: conn.prepare<[string, Slot], { rowid: number }>("SELECT rowid FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq DESC LIMIT 1"),
    deleteRow: conn.prepare<[number]>("DELETE FROM session_tracks WHERE rowid = ?"),
    deleteAt: conn.prepare<[string, Slot, number]>("DELETE FROM session_tracks WHERE guild_id = ? AND slot = ? AND seq = ?"),
    deleteSlot: conn.prepare<[string, Slot]>("DELETE FROM session_tracks WHERE guild_id = ? AND slot = ?"),
    toCurrent: conn.prepare<[number]>("UPDATE session_tracks SET slot = 'current', seq = 0 WHERE rowid = ?"),
    setSeq: conn.prepare<[number, number]>("UPDATE session_tracks SET seq = ? WHERE rowid = ?"),
    seqs: conn.prepare<[string, Slot], { rowid: number; seq: number }>("SELECT rowid, seq FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq"),
    slotRows: conn.prepare<[string, Slot], RawTrackRow>("SELECT * FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq"),
    oneSession: conn.prepare<[string], SessionRow>("SELECT * FROM player_sessions WHERE guild_id = ?"),
    allSessions: conn.prepare<[], SessionRow>("SELECT * FROM player_sessions"),
    guildTracks: conn.prepare<[string], RawTrackRow>("SELECT * FROM session_tracks WHERE guild_id = ? ORDER BY slot, seq"),
    allTracks: conn.prepare<[], RawTrackRow>("SELECT * FROM session_tracks ORDER BY guild_id, slot, seq"),
    liveRefs: conn.prepare<[], { audio_url: string }>("SELECT audio_url FROM session_tracks WHERE slot IN ('current', 'queue') AND audio_url IS NOT NULL"),
  };
}

class PlayerSessionStore {
  db: Db;
  q: ReturnType<typeof queries>;

  constructor(conn: Db) {
    this.db = conn;
    this.q = queries(conn);
  }

  _tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  _ensure(guildId: string) {
    this.q.ensure.run(guildId, Date.now());
  }

  _insert(guildId: string, slot: Slot, seq: number, track: TrackIn) {
    this.q.insert.run({ guild_id: guildId, slot, seq, ...toRow(track) });
  }

  // 슬롯을 0, GAP, 2·GAP…로 다시 매긴다. 행 id가 바뀌므로 호출한 쪽은 위치를 다시 읽어야 한다.
  _renumber(guildId: string, slot: Slot) {
    const rows = this.q.slotRows.all(guildId, slot);
    this.q.deleteSlot.run(guildId, slot);
    rows.forEach((row, i) => {
      // 같은 표의 칸을 그대로 옮긴다
      const columns = Object.fromEntries(TRACK_COLUMNS.map((c) => [c, row[c]])) as TrackParams;
      this.q.insert.run({ guild_id: row.guild_id, slot: row.slot, seq: i * GAP, ...columns });
    });
  }

  _seqAfterLast(guildId: string, slot: Slot): number {
    let max = this.q.maxSeq.get(guildId, slot)?.v ?? null;
    if (max === null) return 0;
    if (max > SEQ_LIMIT) {
      this._renumber(guildId, slot);
      max = this.q.maxSeq.get(guildId, slot)?.v ?? 0;
    }
    return max + GAP;
  }

  _seqBeforeFirst(guildId: string, slot: Slot): number {
    let min = this.q.minSeq.get(guildId, slot)?.v ?? null;
    if (min === null) return 0;
    if (min < -SEQ_LIMIT) {
      this._renumber(guildId, slot);
      min = this.q.minSeq.get(guildId, slot)?.v ?? 0;
    }
    return min - GAP;
  }

  // ── 세션 행 ──

  saveSession(guildId: string, s: SessionState) {
    this.q.upsert.run({
      guild_id: guildId,
      voice_channel_id: s.voiceChannelId ?? null,
      text_channel_id: s.textChannelId ?? null,
      volume: s.volume ?? 100,
      loop_mode: s.loopMode ?? "off",
      autoplay: s.autoplay || null,
      paused_manual: s.pausedManual ? 1 : 0,
      position_ms: Math.max(0, Math.round(s.positionMs ?? 0)),
      start_offset_ms: Math.max(0, Math.round(s.startOffsetMs ?? 0)),
      requester_id: s.requesterId ?? null,
      updated_at: Date.now(),
    });
  }

  // 재생 위치만. 활성 플레이어 전부를 한 트랜잭션에
  savePositions(entries: Array<{ guildId: string; positionMs?: number; startOffsetMs?: number }>) {
    const now = Date.now();
    this._tx(() => {
      for (const e of entries) this.q.position.run(Math.max(0, Math.round(e.positionMs ?? 0)), Math.max(0, Math.round(e.startOffsetMs ?? 0)), now, e.guildId);
    });
  }

  removeSession(guildId: string) {
    this._tx(() => {
      this.q.deleteGuildTracks.run(guildId);
      this.q.deleteSession.run(guildId);
    });
  }

  // ── 트랙 행 (증분) ──

  setCurrent(guildId: string, track: TrackIn | null | undefined) {
    this._tx(() => {
      this.q.deleteSlot.run(guildId, "current");
      if (!track) return; // 비우기만 할 때는 세션 행을 새로 만들지 않는다
      this._ensure(guildId);
      this._insert(guildId, "current", 0, track);
    });
  }

  append(guildId: string, tracks: TrackIn[] | null | undefined, { front = false } = {}) {
    if (!tracks?.length) return;
    this._tx(() => {
      this._ensure(guildId);
      if (front) {
        for (let i = tracks.length - 1; i >= 0; i--) this._insert(guildId, "queue", this._seqBeforeFirst(guildId, "queue"), tracks[i]);
      } else {
        for (const track of tracks) this._insert(guildId, "queue", this._seqAfterLast(guildId, "queue"), track);
      }
    });
  }

  // 대기열 index번째를 현재곡으로. 있던 현재곡 행은 버린다(기록은 retire가 따로 남긴다)
  take(guildId: string, index: number): boolean {
    return this._tx(() => {
      const row = this.q.rowidAt.get(guildId, "queue", index);
      if (!row) return false;
      this.q.deleteSlot.run(guildId, "current");
      this.q.toCurrent.run(row.rowid);
      return true;
    });
  }

  retire(guildId: string, track: TrackIn, { requeue = false } = {}) {
    this._tx(() => {
      this._ensure(guildId);
      this._insert(guildId, "history", this._seqAfterLast(guildId, "history"), track);
      while ((this.q.count.get(guildId, "history")?.n ?? 0) > HISTORY_MAX) {
        const oldest = this.q.rowidAt.get(guildId, "history", 0);
        if (!oldest) break;
        this.q.deleteRow.run(oldest.rowid);
      }
      if (requeue) this._insert(guildId, "queue", this._seqAfterLast(guildId, "queue"), track);
    });
  }

  removeAt(guildId: string, index: number): boolean {
    return this._tx(() => {
      const row = this.q.rowidAt.get(guildId, "queue", index);
      if (!row) return false;
      this.q.deleteRow.run(row.rowid);
      return true;
    });
  }

  move(guildId: string, from: number, to: number): boolean {
    return this._tx(() => {
      let rows = this.q.seqs.all(guildId, "queue");
      if (!(from >= 0 && from < rows.length && to >= 0 && to < rows.length)) return false;
      if (from === to) return true;

      const place = () => {
        const list = rows.slice();
        const [moving] = list.splice(from, 1);
        const prev = list[to - 1];
        const next = list[to];
        const seq = !prev ? next.seq - GAP : !next ? prev.seq + GAP : Math.floor((prev.seq + next.seq) / 2);
        const fits = (!prev || seq > prev.seq) && (!next || seq < next.seq) && Math.abs(seq) <= SEQ_LIMIT;
        return { moving, seq, fits };
      };

      let spot = place();
      if (!spot.fits) {
        this._renumber(guildId, "queue");
        rows = this.q.seqs.all(guildId, "queue");
        spot = place();
      }
      this.q.setSeq.run(spot.seq, spot.moving.rowid);
      return true;
    });
  }

  // 이전곡. 기록의 마지막 곡을 대기열 맨 앞에, 중단된 현재곡을 그 뒤에. 큐 반복 사본(copy번째)은 먼저 뺀다.
  rewind(guildId: string, track: TrackIn, { copy = -1, current = null }: { copy?: number; current?: TrackIn | null } = {}): boolean {
    return this._tx(() => {
      const last = this.q.lastRowid.get(guildId, "history");
      const copyRow = copy >= 0 ? this.q.rowidAt.get(guildId, "queue", copy) : null;
      if (!last || (copy >= 0 && !copyRow)) return false;
      if (copyRow) this.q.deleteRow.run(copyRow.rowid);
      this.q.deleteRow.run(last.rowid);
      if (current) this._insert(guildId, "queue", this._seqBeforeFirst(guildId, "queue"), current);
      this._insert(guildId, "queue", this._seqBeforeFirst(guildId, "queue"), track);
      return true;
    });
  }

  clearQueue(guildId: string) {
    this.q.deleteSlot.run(guildId, "queue");
  }

  reset(guildId: string, { history = false } = {}) {
    this._tx(() => {
      this.q.deleteSlot.run(guildId, "current");
      this.q.deleteSlot.run(guildId, "queue");
      if (history) this.q.deleteSlot.run(guildId, "history");
    });
  }

  // ── 트랙 행 (통째로). 셔플처럼 드문 것, 그리고 어긋났을 때 ──

  replaceTracks(guildId: string, { current = null, queue = [], history = [] }: { current?: TrackIn | null; queue?: TrackIn[]; history?: TrackIn[] }) {
    this._tx(() => {
      this._ensure(guildId);
      this.q.deleteGuildTracks.run(guildId);
      if (current) this._insert(guildId, "current", 0, current);
      queue.forEach((track, i) => this._insert(guildId, "queue", i * GAP, track));
      history.slice(-HISTORY_MAX).forEach((track, i) => this._insert(guildId, "history", i * GAP, track));
    });
  }

  // ── 읽기 ──

  load(guildId: string) {
    const session = this.q.oneSession.get(guildId);
    if (!session) return null;
    return { guildId, session: sessionFromRow(session), ...this._group(this.q.guildTracks.all(guildId)) };
  }

  _group(rows: RawTrackRow[]) {
    return groupTracks(rows, (row) => this.q.deleteAt.run(row.guild_id, row.slot, row.seq));
  }

  loadAll() {
    const byGuild = new Map<string, RawTrackRow[]>();
    for (const row of this.q.allTracks.all()) {
      const list = byGuild.get(row.guild_id);
      if (list) list.push(row);
      else byGuild.set(row.guild_id, [row]);
    }
    return this.q.allSessions.all().map((s) => ({ guildId: s.guild_id, session: sessionFromRow(s), ...this._group(byGuild.get(s.guild_id) || []) }));
  }

  // 기동 시 고아 파일 청소가 지켜야 할 곡의 음원 주소. 현재곡과 대기열(기록은 다시 받으면 된다)
  liveAudioUrls(): string[] {
    return this.q.liveRefs.all().map((r) => r.audio_url);
  }
}

// 모양이 틀린 행은 버리고 DB 에서도 지운다. 남겨 두면 메모리의 i번째와 DB 의 i번째 행이 어긋난다
type RestoredTrack = ReturnType<typeof fromRow>;

function groupTracks(rows: RawTrackRow[], drop: (row: RawTrackRow) => void) {
  const out: { current: RestoredTrack | null; queue: RestoredTrack[]; history: RestoredTrack[] } = { current: null, queue: [], history: [] };
  for (const raw of rows) {
    const row = checked(SessionTrackRow, raw, "세션 트랙");
    if (!row) {
      drop(raw);
      continue;
    }
    const track = fromRow(row);
    if (row.slot === "current") out.current = track;
    else out[row.slot].push(track);
  }
  return out;
}

// 열린 캐시 DB 에 붙은 저장소 하나. 다시 열면(테스트의 임시 DB 등) 새로 붙는다. 열기 전에 부르면 db 가 던진다
let bound: PlayerSessionStore | null = null;
function sessions(): PlayerSessionStore {
  const conn = db.get();
  if (!bound || bound.db !== conn) bound = new PlayerSessionStore(conn);
  return bound;
}

export { PlayerSessionStore, sessions, GAP, SEQ_LIMIT };

type RestoredSession = NonNullable<ReturnType<PlayerSessionStore["load"]>>;
export type { TrackIn, SessionState, RestoredTrack, RestoredSession, LoopMode };
