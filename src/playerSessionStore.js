"use strict";

// 플레이어 세션 저장소 — 길드당 세션 한 행 + 현재곡·대기열·기록 트랙 행.
// DB는 재시작 복원용 사본이다. 재생 중의 진실은 메모리 배열이고, 슬롯 안의 행 순서는 그 배열 순서와 같다.
// 그래서 i번째 곡은 seq를 들고 다니지 않고 `ORDER BY seq LIMIT 1 OFFSET i`로 찾는다.

const { HISTORY_MAX } = require("./trackState");

// 끼워넣을 때 양옆의 중간값을 쓰므로 간격이 클수록 재번호 없이 오래 버틴다
const GAP = 1_000_000_000;
// better-sqlite3는 정수를 JS Number로 준다 — 2^53을 넘으면 정밀도가 깨지므로 그 전에 재번호한다
const SEQ_LIMIT = Number.MAX_SAFE_INTEGER - GAP;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS player_sessions (
    guild_id               TEXT    PRIMARY KEY,
    voice_channel_id       TEXT,
    text_channel_id        TEXT,
    volume                 INTEGER NOT NULL DEFAULT 100,
    loop_mode              TEXT    NOT NULL DEFAULT 'off' CHECK (loop_mode IN ('off', 'track', 'queue')),
    autoplay               TEXT,
    paused_manual          INTEGER NOT NULL DEFAULT 0,
    position_ms            INTEGER NOT NULL DEFAULT 0,
    start_offset_ms        INTEGER NOT NULL DEFAULT 0,
    requester_id           TEXT,
    updated_at             INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_tracks (
    guild_id         TEXT    NOT NULL REFERENCES player_sessions(guild_id) ON DELETE CASCADE,
    slot             TEXT    NOT NULL CHECK (slot IN ('current', 'queue', 'history')),
    seq              INTEGER NOT NULL,
    track_id         TEXT,
    source_url       TEXT,
    audio_source_key TEXT,
    title            TEXT,
    artist           TEXT,
    album            TEXT,
    uploader         TEXT,
    duration_sec     REAL,
    thumbnail        TEXT,
    platform         TEXT,
    is_live          INTEGER NOT NULL DEFAULT 0,
    youtube_url      TEXT,
    requester_id     TEXT,
    added_at         INTEGER NOT NULL,
    PRIMARY KEY (guild_id, slot, seq)
  );
`;

const TRACK_COLUMNS = ["track_id", "source_url", "audio_source_key", "title", "artist", "album", "uploader", "duration_sec", "thumbnail", "platform", "is_live", "youtube_url", "requester_id", "added_at"];

function createTables(db) {
  db.exec(SCHEMA);
}

function toRow(track) {
  return {
    track_id: track.id || null,
    source_url: track.url || null,
    audio_source_key: track.audioSourceKey || null,
    title: track.title || null,
    artist: track.artist || null,
    album: track.album || null,
    uploader: track.uploader || null,
    duration_sec: typeof track.duration === "number" ? track.duration : Number(track.duration) || null,
    thumbnail: track.thumbnail || null,
    platform: track.platform || null,
    is_live: track.isLive || track.live ? 1 : 0,
    youtube_url: track.youtubeUrl || null,
    requester_id: track.requestedBy?.id || track.requesterId || null,
    added_at: track.addedAt || Date.now(),
  };
}

function fromRow(row) {
  return {
    id: row.track_id,
    title: row.title,
    url: row.source_url,
    duration: row.duration_sec,
    thumbnail: row.thumbnail,
    artist: row.artist,
    album: row.album,
    uploader: row.uploader,
    platform: row.platform,
    audioSourceKey: row.audio_source_key,
    youtubeUrl: row.youtube_url,
    isLive: Boolean(row.is_live),
    addedAt: row.added_at,
    requesterId: row.requester_id,
  };
}

function sessionFromRow(row) {
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

class PlayerSessionStore {
  constructor(db) {
    this.db = db;
    const cols = TRACK_COLUMNS.join(", ");
    const params = TRACK_COLUMNS.map((c) => `@${c}`).join(", ");
    const q = (sql) => db.prepare(sql);
    this.q = {
      ensure: q("INSERT OR IGNORE INTO player_sessions (guild_id, updated_at) VALUES (?, ?)"),
      upsert: q(`
        INSERT INTO player_sessions (guild_id, voice_channel_id, text_channel_id, volume, loop_mode, autoplay,
                                     paused_manual, position_ms, start_offset_ms, requester_id, updated_at)
        VALUES (@guild_id, @voice_channel_id, @text_channel_id, @volume, @loop_mode, @autoplay,
                @paused_manual, @position_ms, @start_offset_ms, @requester_id, @updated_at)
        ON CONFLICT(guild_id) DO UPDATE SET
          voice_channel_id = excluded.voice_channel_id, text_channel_id = excluded.text_channel_id,
          volume = excluded.volume, loop_mode = excluded.loop_mode, autoplay = excluded.autoplay,
          paused_manual = excluded.paused_manual, position_ms = excluded.position_ms, start_offset_ms = excluded.start_offset_ms,
          requester_id = excluded.requester_id, updated_at = excluded.updated_at`),
      position: q("UPDATE player_sessions SET position_ms = ?, start_offset_ms = ?, updated_at = ? WHERE guild_id = ?"),
      deleteSession: q("DELETE FROM player_sessions WHERE guild_id = ?"),
      deleteGuildTracks: q("DELETE FROM session_tracks WHERE guild_id = ?"),
      insert: q(`INSERT INTO session_tracks (guild_id, slot, seq, ${cols}) VALUES (@guild_id, @slot, @seq, ${params})`),
      minSeq: q("SELECT MIN(seq) AS v FROM session_tracks WHERE guild_id = ? AND slot = ?"),
      maxSeq: q("SELECT MAX(seq) AS v FROM session_tracks WHERE guild_id = ? AND slot = ?"),
      count: q("SELECT COUNT(*) AS n FROM session_tracks WHERE guild_id = ? AND slot = ?"),
      rowidAt: q("SELECT rowid FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq LIMIT 1 OFFSET ?"),
      lastRowid: q("SELECT rowid FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq DESC LIMIT 1"),
      deleteRow: q("DELETE FROM session_tracks WHERE rowid = ?"),
      deleteSlot: q("DELETE FROM session_tracks WHERE guild_id = ? AND slot = ?"),
      toCurrent: q("UPDATE session_tracks SET slot = 'current', seq = 0 WHERE rowid = ?"),
      setSeq: q("UPDATE session_tracks SET seq = ? WHERE rowid = ?"),
      seqs: q("SELECT rowid, seq FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq"),
      slotRows: q("SELECT * FROM session_tracks WHERE guild_id = ? AND slot = ? ORDER BY seq"),
      oneSession: q("SELECT * FROM player_sessions WHERE guild_id = ?"),
      allSessions: q("SELECT * FROM player_sessions"),
      guildTracks: q("SELECT * FROM session_tracks WHERE guild_id = ? ORDER BY slot, seq"),
      allTracks: q("SELECT * FROM session_tracks ORDER BY guild_id, slot, seq"),
      liveRefs: q("SELECT audio_source_key, source_url FROM session_tracks WHERE slot IN ('current', 'queue')"),
    };
  }

  _tx(fn) {
    return this.db.transaction(fn)();
  }

  _ensure(guildId) {
    this.q.ensure.run(guildId, Date.now());
  }

  _insert(guildId, slot, seq, track) {
    this.q.insert.run({ guild_id: guildId, slot, seq, ...toRow(track) });
  }

  // 슬롯을 0, GAP, 2·GAP…로 다시 매긴다. 행 id가 바뀌므로 호출한 쪽은 위치를 다시 읽어야 한다.
  _renumber(guildId, slot) {
    const rows = this.q.slotRows.all(guildId, slot);
    this.q.deleteSlot.run(guildId, slot);
    rows.forEach((row, i) => {
      const params = { guild_id: row.guild_id, slot: row.slot, seq: i * GAP };
      for (const c of TRACK_COLUMNS) params[c] = row[c];
      this.q.insert.run(params);
    });
  }

  _seqAfterLast(guildId, slot) {
    let max = this.q.maxSeq.get(guildId, slot).v;
    if (max === null) return 0;
    if (max > SEQ_LIMIT) {
      this._renumber(guildId, slot);
      max = this.q.maxSeq.get(guildId, slot).v;
    }
    return max + GAP;
  }

  _seqBeforeFirst(guildId, slot) {
    let min = this.q.minSeq.get(guildId, slot).v;
    if (min === null) return 0;
    if (min < -SEQ_LIMIT) {
      this._renumber(guildId, slot);
      min = this.q.minSeq.get(guildId, slot).v;
    }
    return min - GAP;
  }

  // ── 세션 행 ──

  saveSession(guildId, s) {
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

  // 재생 위치만 — 활성 플레이어 전부를 한 트랜잭션에
  savePositions(entries) {
    const now = Date.now();
    this._tx(() => {
      for (const e of entries) this.q.position.run(Math.max(0, Math.round(e.positionMs ?? 0)), Math.max(0, Math.round(e.startOffsetMs ?? 0)), now, e.guildId);
    });
  }

  removeSession(guildId) {
    this._tx(() => {
      this.q.deleteGuildTracks.run(guildId);
      this.q.deleteSession.run(guildId);
    });
  }

  // ── 트랙 행 (증분) ──

  setCurrent(guildId, track) {
    this._tx(() => {
      this.q.deleteSlot.run(guildId, "current");
      if (!track) return; // 비우기만 할 때는 세션 행을 새로 만들지 않는다
      this._ensure(guildId);
      this._insert(guildId, "current", 0, track);
    });
  }

  append(guildId, tracks, { front = false } = {}) {
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

  // 대기열 index번째를 현재곡으로 — 있던 현재곡 행은 버린다(기록은 retire가 따로 남긴다)
  take(guildId, index) {
    return this._tx(() => {
      const row = this.q.rowidAt.get(guildId, "queue", index);
      if (!row) return false;
      this.q.deleteSlot.run(guildId, "current");
      this.q.toCurrent.run(row.rowid);
      return true;
    });
  }

  retire(guildId, track, { requeue = false } = {}) {
    this._tx(() => {
      this._ensure(guildId);
      this._insert(guildId, "history", this._seqAfterLast(guildId, "history"), track);
      while (this.q.count.get(guildId, "history").n > HISTORY_MAX) {
        this.q.deleteRow.run(this.q.rowidAt.get(guildId, "history", 0).rowid);
      }
      if (requeue) this._insert(guildId, "queue", this._seqAfterLast(guildId, "queue"), track);
    });
  }

  removeAt(guildId, index) {
    return this._tx(() => {
      const row = this.q.rowidAt.get(guildId, "queue", index);
      if (!row) return false;
      this.q.deleteRow.run(row.rowid);
      return true;
    });
  }

  move(guildId, from, to) {
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

  // 이전곡 — 기록의 마지막 곡을 대기열 맨 앞에, 중단된 현재곡을 그 뒤에. 큐 반복 사본(copy번째)은 먼저 뺀다.
  rewind(guildId, track, { copy = -1, current = null } = {}) {
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

  clearQueue(guildId) {
    this.q.deleteSlot.run(guildId, "queue");
  }

  reset(guildId, { history = false } = {}) {
    this._tx(() => {
      this.q.deleteSlot.run(guildId, "current");
      this.q.deleteSlot.run(guildId, "queue");
      if (history) this.q.deleteSlot.run(guildId, "history");
    });
  }

  // ── 트랙 행 (통째로) — 셔플처럼 드문 것, 그리고 어긋났을 때 ──

  replaceTracks(guildId, { current = null, queue = [], history = [] }) {
    this._tx(() => {
      this._ensure(guildId);
      this.q.deleteGuildTracks.run(guildId);
      if (current) this._insert(guildId, "current", 0, current);
      queue.forEach((track, i) => this._insert(guildId, "queue", i * GAP, track));
      history.slice(-HISTORY_MAX).forEach((track, i) => this._insert(guildId, "history", i * GAP, track));
    });
  }

  // ── 읽기 ──

  load(guildId) {
    const session = this.q.oneSession.get(guildId);
    if (!session) return null;
    return { guildId, session: sessionFromRow(session), ...groupTracks(this.q.guildTracks.all(guildId)) };
  }

  loadAll() {
    const byGuild = new Map();
    for (const row of this.q.allTracks.all()) {
      if (!byGuild.has(row.guild_id)) byGuild.set(row.guild_id, []);
      byGuild.get(row.guild_id).push(row);
    }
    return this.q.allSessions.all().map((s) => ({ guildId: s.guild_id, session: sessionFromRow(s), ...groupTracks(byGuild.get(s.guild_id) || []) }));
  }

  // 기동 시 고아 파일 청소가 지켜야 할 곡 — 현재곡과 대기열(기록은 다시 받으면 된다)
  liveTrackRefs() {
    return this.q.liveRefs.all().map((r) => ({ audioSourceKey: r.audio_source_key, url: r.source_url }));
  }
}

function groupTracks(rows) {
  const out = { current: null, queue: [], history: [] };
  for (const row of rows) {
    const track = fromRow(row);
    if (row.slot === "current") out.current = track;
    else out[row.slot].push(track);
  }
  return out;
}

module.exports = { PlayerSessionStore, createTables, SCHEMA, GAP, SEQ_LIMIT };
