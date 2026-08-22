"use strict";

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "database", "cache.db");
const CACHE_DIR = path.join(__dirname, "..", "audio_cache");

// 제거 점수 가중치
const W_RECENCY = 0.4;
const W_FREQUENCY = 0.4;
const W_SIZE = 0.2;
// 고정 크기 기준: opus 128kbps ≈ 1 MB/분 → 50 MB ≈ 50분
const SIZE_REF_BYTES = 50 * 1024 * 1024;

class CacheManager {
  constructor() {
    this.db = null;
    this._initialized = false;
    this._protectedKeys = new Set(); // 현재 재생 중이거나 사전 캐시된 audio_source_key
    this._evictInterval = null;
    this._cacheDir = CACHE_DIR; // 테스트에서 재정의 가능
  }

  // 초기화 — dbPath는 테스트 주입용(임시 DB), 운영은 항상 기본 경로
  initialize(dbPath = DB_PATH) {
    if (this._initialized) return;

    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    this._createTables();
    this._initialized = true;
    this._startPeriodicEviction();
    console.log("[CacheManager] SQLite DB 초기화 완료");
  }

  _createTables() {
    this.db.exec(`
            CREATE TABLE IF NOT EXISTS audio_cache (
                audio_source_key    TEXT PRIMARY KEY,
                status              TEXT NOT NULL DEFAULT 'downloading',
                file_path           TEXT,
                file_size_bytes     INTEGER,
                duration_sec        REAL,
                title               TEXT,
                channel             TEXT,
                content_fingerprint TEXT,
                verification_policy TEXT NOT NULL DEFAULT 'infrequent',
                last_verified_at    INTEGER,
                play_count          INTEGER NOT NULL DEFAULT 0,
                last_played_at      INTEGER,
                downloaded_at       INTEGER,
                created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS track_lookup (
                source_url          TEXT PRIMARY KEY,
                audio_source_key    TEXT NOT NULL,
                platform            TEXT NOT NULL,
                display_title       TEXT,
                display_artist      TEXT,
                display_thumbnail   TEXT,
                created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                FOREIGN KEY (audio_source_key)
                    REFERENCES audio_cache(audio_source_key) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS player_sessions (
                guild_id    TEXT PRIMARY KEY,
                state_json  TEXT NOT NULL,
                updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id                 TEXT PRIMARY KEY,
                bot_channel_id           TEXT,
                dj_role_ids              TEXT,
                sponsorblock_enabled     INTEGER,   -- NULL=상속(전역 기본), 0/1
                sponsorblock_categories  TEXT,       -- NULL=상속, JSON 배열
                updated_at               INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );

            -- SponsorBlock 원시 세그먼트 캐시 (폴백 전용 — 라이브 조회 실패 시 사용).
            -- data_json = 정규화 이전 원시 배열(카테고리 전부). 정규화/필터는 SponsorBlock.js가 읽을 때 수행.
            CREATE TABLE IF NOT EXISTS sponsorblock_cache (
                video_id    TEXT PRIMARY KEY,
                data_json   TEXT NOT NULL,
                fetched_at  INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ac_status      ON audio_cache(status);
            CREATE INDEX IF NOT EXISTS idx_ac_last_played ON audio_cache(last_played_at);
            CREATE INDEX IF NOT EXISTS idx_tl_audio_key   ON track_lookup(audio_source_key);
        `);

    // 컬럼 추가 이전에 만들어진 기존 DB 마이그레이션 (CREATE IF NOT EXISTS는 컬럼을 추가하지 않음)
    const gsCols = this.db
      .prepare("PRAGMA table_info(guild_settings)")
      .all()
      .map((c) => c.name);
    if (!gsCols.includes("dj_role_ids")) {
      this.db.exec("ALTER TABLE guild_settings ADD COLUMN dj_role_ids TEXT");

      // 구 단일 역할 컬럼(dj_role_id) → 복수 역할(JSON 배열) 1회 이관.
      // 구 컬럼은 롤백 대비 보존하되 이후 코드는 참조하지 않는다.
      if (gsCols.includes("dj_role_id")) {
        const rows = this.db.prepare("SELECT guild_id, dj_role_id FROM guild_settings WHERE dj_role_id IS NOT NULL").all();
        const upd = this.db.prepare("UPDATE guild_settings SET dj_role_ids = ? WHERE guild_id = ?");
        for (const r of rows) upd.run(JSON.stringify([r.dj_role_id]), r.guild_id);
        if (rows.length) console.log(`[CacheManager] DJ 역할 설정 ${rows.length}건을 복수 역할 형식(dj_role_ids)으로 이관`);
      }
    }

    // SponsorBlock 컬럼 추가 (컬럼 도입 이전 DB 대응 — CREATE IF NOT EXISTS는 컬럼을 안 만듦)
    const gsCols2 = this.db
      .prepare("PRAGMA table_info(guild_settings)")
      .all()
      .map((c) => c.name);
    if (!gsCols2.includes("sponsorblock_enabled")) this.db.exec("ALTER TABLE guild_settings ADD COLUMN sponsorblock_enabled INTEGER");
    if (!gsCols2.includes("sponsorblock_categories")) this.db.exec("ALTER TABLE guild_settings ADD COLUMN sponsorblock_categories TEXT");
  }

  // 정적 헬퍼
  static md5(str) {
    return crypto.createHash("md5").update(String(str)).digest("hex");
  }

  /** audio_source_key에 대한 결정적 파일 경로 */
  getFilePath(audioSourceKey) {
    return path.join(CACHE_DIR, `track_${CacheManager.md5(audioSourceKey)}.opus`);
  }

  // 라이브 보호 (재생 중/사전 캐시된 트랙)

  /** 키를 사용 중으로 표시 — 제거 대상에서 건너뜀 */
  protect(audioSourceKey) {
    if (audioSourceKey) this._protectedKeys.add(audioSourceKey);
  }

  /** 더 이상 필요하지 않은 키 해제 */
  unprotect(audioSourceKey) {
    if (audioSourceKey) this._protectedKeys.delete(audioSourceKey);
  }

  // 조회 (읽기)

  /**
   * 소스 URL을 캐시된 파일 경로와 트랙 메타데이터로 해석합니다.
   * { hit: false } 또는 { hit: true, track, audioSourceKey, filePath }를 반환합니다.
   */
  _normalizeSourceUrl(sourceUrl) {
    if (typeof sourceUrl !== "string") return sourceUrl;
    // 순환 의존성 문제를 피하기 위해 지연 require
    const YouTube = require("./YouTube");
    const videoId = YouTube.extractVideoId(sourceUrl);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : sourceUrl;
  }

  resolveFromCache(sourceUrl) {
    if (!this._initialized) this.initialize();
    sourceUrl = this._normalizeSourceUrl(sourceUrl);

    const row = this.db
      .prepare(
        `
            SELECT tl.source_url, tl.platform, tl.display_title, tl.display_artist, tl.display_thumbnail,
                   ac.audio_source_key, ac.status, ac.file_path, ac.duration_sec,
                   ac.title, ac.channel
            FROM track_lookup tl
            JOIN audio_cache ac ON tl.audio_source_key = ac.audio_source_key
            WHERE tl.source_url = ?
        `,
      )
      .get(sourceUrl);

    if (!row || row.status !== "cached") return { hit: false };

    const filePath = row.file_path || this.getFilePath(row.audio_source_key);
    if (!fs.existsSync(filePath)) {
      this.db.prepare(`UPDATE audio_cache SET status = 'error', file_path = NULL, updated_at = ? WHERE audio_source_key = ?`).run(Date.now(), row.audio_source_key);
      return { hit: false };
    }

    const cachedTrack = {
      url: row.source_url,
      platform: row.platform,
      title: row.display_title || row.title,
      artist: row.display_artist || row.channel,
      thumbnail: row.display_thumbnail,
      duration: row.duration_sec,
      audioSourceKey: row.audio_source_key,
      _cachedFilePath: filePath,
    };

    if (row.platform === "spotify" && row.audio_source_key.startsWith("yt:")) {
      cachedTrack.youtubeUrl = `https://www.youtube.com/watch?v=${row.audio_source_key.slice(3)}`;
    }

    return { hit: true, track: cachedTrack, audioSourceKey: row.audio_source_key, filePath };
  }

  /** audio_source_key로 원시 조회 */
  lookupByAudioKey(audioSourceKey) {
    if (!this._initialized) this.initialize();
    return this.db.prepare("SELECT * FROM audio_cache WHERE audio_source_key = ?").get(audioSourceKey) || null;
  }

  // 쓰기 — audio_cache

  recordDownloadStart(audioSourceKey, track) {
    if (!this._initialized) this.initialize();
    const now = Date.now();
    this.db
      .prepare(
        `
            INSERT INTO audio_cache
                (audio_source_key, status, duration_sec, title, channel,
                 verification_policy, created_at, updated_at)
            VALUES (?, 'downloading', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(audio_source_key) DO UPDATE SET
                status     = 'downloading',
                updated_at = excluded.updated_at
        `,
      )
      .run(audioSourceKey, track?.duration || null, track?.title || null, track?.artist || track?.channel || null, this._verificationPolicy(audioSourceKey), now, now);
  }

  recordDownloadComplete(audioSourceKey, filePath, fileSizeBytes, track) {
    if (!this._initialized) this.initialize();
    const now = Date.now();
    this.db
      .prepare(
        `
            UPDATE audio_cache SET
                status              = 'cached',
                file_path           = ?,
                file_size_bytes     = ?,
                title               = COALESCE(?, title),
                channel             = COALESCE(?, channel),
                duration_sec        = COALESCE(?, duration_sec),
                content_fingerprint = ?,
                downloaded_at       = ?,
                last_verified_at    = ?,
                updated_at          = ?
            WHERE audio_source_key = ?
        `,
      )
      .run(filePath, fileSizeBytes, track?.title || null, track?.artist || track?.channel || null, track?.duration || null, `size:${fileSizeBytes}`, now, now, now, audioSourceKey);

    // 다운로드 후 제거 검사 (논블로킹)
    setImmediate(() => this.evictIfNeeded().catch(() => {}));
  }

  recordError(audioSourceKey) {
    if (!this._initialized) this.initialize();
    this.db.prepare(`UPDATE audio_cache SET status = 'error', updated_at = ? WHERE audio_source_key = ?`).run(Date.now(), audioSourceKey);
  }

  recordPlayback(audioSourceKey) {
    if (!this._initialized) this.initialize();
    const now = Date.now();
    this.db
      .prepare(
        `
            UPDATE audio_cache SET play_count = play_count + 1, last_played_at = ?, updated_at = ?
            WHERE audio_source_key = ?
        `,
      )
      .run(now, now, audioSourceKey);
  }

  // 쓰기 — track_lookup

  recordTrackLookup(sourceUrl, platform, audioSourceKey, displayTitle, displayArtist, displayThumbnail) {
    if (!this._initialized) this.initialize();
    sourceUrl = this._normalizeSourceUrl(sourceUrl);
    const now = Date.now();
    this.db
      .prepare(
        `
            INSERT INTO track_lookup
                (source_url, audio_source_key, platform, display_title, display_artist, display_thumbnail,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_url) DO UPDATE SET
                audio_source_key  = excluded.audio_source_key,
                display_title     = excluded.display_title,
                display_artist    = excluded.display_artist,
                display_thumbnail = excluded.display_thumbnail,
                updated_at        = excluded.updated_at
        `,
      )
      .run(sourceUrl, audioSourceKey, platform, displayTitle || null, displayArtist || null, displayThumbnail || null, now, now);
  }

  // 검증 정책

  _verificationPolicy(audioSourceKey) {
    if (audioSourceKey.startsWith("sc:")) return "periodic"; // 24시간
    if (audioSourceKey.startsWith("dl:")) return "always"; // 매 재생
    return "infrequent"; // 30일 (yt:*)
  }

  /** 재생 전에 캐시 항목을 재검증해야 하면 true 반환 */
  shouldVerify(cacheRow) {
    if (!cacheRow) return true;
    const policy = cacheRow.verification_policy;
    const lastVerified = cacheRow.last_verified_at || 0;
    const age = Date.now() - lastVerified;

    if (policy === "always") return true;
    if (policy === "periodic") return age > 24 * 60 * 60 * 1000;
    if (policy === "infrequent") return age > 30 * 24 * 60 * 60 * 1000;
    return false;
  }

  // 플레이어 세션

  savePlayerSession(guildId, state) {
    if (!this._initialized) this.initialize();
    this.db
      .prepare(
        `
            INSERT INTO player_sessions (guild_id, state_json, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
        `,
      )
      .run(guildId, JSON.stringify(state), Date.now());
  }

  getPlayerSession(guildId) {
    if (!this._initialized) this.initialize();
    const row = this.db.prepare("SELECT state_json FROM player_sessions WHERE guild_id = ?").get(guildId);
    if (!row) return null;
    try {
      return JSON.parse(row.state_json);
    } catch {
      return null;
    }
  }

  removePlayerSession(guildId) {
    if (!this._initialized) this.initialize();
    this.db.prepare("DELETE FROM player_sessions WHERE guild_id = ?").run(guildId);
  }

  getAllPlayerSessions() {
    if (!this._initialized) this.initialize();
    const rows = this.db.prepare("SELECT guild_id, state_json FROM player_sessions").all();
    const result = {};
    for (const row of rows) {
      try {
        result[row.guild_id] = JSON.parse(row.state_json);
      } catch {
        /* 건너뜀 */
      }
    }
    return result;
  }

  /** 저장된 세션에서 참조하는 파일 경로 — 시작 시 고아 파일 정리용 */
  getProtectedCacheFiles() {
    const sessions = this.getAllPlayerSessions();
    const files = new Set();
    for (const state of Object.values(sessions)) {
      for (const f of state.downloadedFiles || []) {
        if (f) files.add(path.resolve(f));
      }
      if (state.currentDownloadedFile) files.add(path.resolve(state.currentDownloadedFile));
    }
    return files;
  }

  // 길드 설정

  getBotChannel(guildId) {
    if (!this._initialized) this.initialize();
    const row = this.db.prepare("SELECT bot_channel_id FROM guild_settings WHERE guild_id = ?").get(guildId);
    return row?.bot_channel_id ?? null;
  }

  setBotChannel(guildId, channelId) {
    if (!this._initialized) this.initialize();
    this.db
      .prepare(
        `
            INSERT INTO guild_settings (guild_id, bot_channel_id, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                bot_channel_id = excluded.bot_channel_id,
                updated_at     = excluded.updated_at
        `,
      )
      .run(guildId, channelId, Date.now());
  }

  clearBotChannel(guildId) {
    if (!this._initialized) this.initialize();
    // 행에는 다른 설정(dj_role_ids)도 담겨 있으므로 행 삭제가 아닌 컬럼 초기화
    this.db.prepare("UPDATE guild_settings SET bot_channel_id = NULL, updated_at = ? WHERE guild_id = ?").run(Date.now(), guildId);
  }

  /** DJ 역할 ID 목록 — 미설정이면 빈 배열 */
  getDjRoles(guildId) {
    if (!this._initialized) this.initialize();
    const row = this.db.prepare("SELECT dj_role_ids FROM guild_settings WHERE guild_id = ?").get(guildId);
    if (!row?.dj_role_ids) return [];
    try {
      const parsed = JSON.parse(row.dj_role_ids);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  setDjRoles(guildId, roleIds) {
    if (!this._initialized) this.initialize();
    const value = roleIds.length ? JSON.stringify(roleIds) : null; // 빈 배열 = 미설정과 동일
    this.db
      .prepare(
        `
            INSERT INTO guild_settings (guild_id, dj_role_ids, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                dj_role_ids = excluded.dj_role_ids,
                updated_at  = excluded.updated_at
        `,
      )
      .run(guildId, value, Date.now());
  }

  clearDjRoles(guildId) {
    if (!this._initialized) this.initialize();
    this.db.prepare("UPDATE guild_settings SET dj_role_ids = NULL, updated_at = ? WHERE guild_id = ?").run(Date.now(), guildId);
  }

  /** 서버별 SponsorBlock 설정 — { enabled: null|bool, categories: null|string[] } (null=전역 상속) */
  getGuildSponsorBlock(guildId) {
    if (!this._initialized) this.initialize();
    const row = this.db.prepare("SELECT sponsorblock_enabled, sponsorblock_categories FROM guild_settings WHERE guild_id = ?").get(guildId);
    if (!row) return { enabled: null, categories: null };
    let categories = null;
    if (row.sponsorblock_categories) {
      try {
        const p = JSON.parse(row.sponsorblock_categories);
        if (Array.isArray(p)) categories = p;
      } catch {
        /* 손상 값은 상속 취급 */
      }
    }
    const enabled = row.sponsorblock_enabled === null || row.sponsorblock_enabled === undefined ? null : !!row.sponsorblock_enabled;
    return { enabled, categories };
  }

  /** 서버별 SponsorBlock 설정 저장. enabled/categories 각각 null이면 "상속"으로 기록. */
  setGuildSponsorBlock(guildId, { enabled, categories }) {
    if (!this._initialized) this.initialize();
    const encEnabled = enabled === null || enabled === undefined ? null : enabled ? 1 : 0;
    const encCats = Array.isArray(categories) ? JSON.stringify(categories) : null;
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, sponsorblock_enabled, sponsorblock_categories, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             sponsorblock_enabled    = excluded.sponsorblock_enabled,
             sponsorblock_categories = excluded.sponsorblock_categories,
             updated_at              = excluded.updated_at`,
      )
      .run(guildId, encEnabled, encCats, Date.now());
  }

  // 시작 시 정리

  async onStartup() {
    if (!this._initialized) this.initialize();

    // 1. 다운로드 중 중단된 행 재설정
    const resetCount = this.db.prepare("UPDATE audio_cache SET status = 'error', updated_at = ? WHERE status = 'downloading'").run(Date.now()).changes;
    if (resetCount > 0) console.log(`[CacheManager] 인터럽트된 다운로드 ${resetCount}건 초기화`);

    // 2. 캐시된 행의 파일이 디스크에 아직 있는지 확인
    const cachedRows = this.db.prepare("SELECT audio_source_key, file_path FROM audio_cache WHERE status = 'cached'").all();
    let orphanDbCount = 0;
    for (const row of cachedRows) {
      const fp = row.file_path || this.getFilePath(row.audio_source_key);
      if (!fs.existsSync(fp)) {
        this.db.prepare("UPDATE audio_cache SET status = 'error', file_path = NULL, updated_at = ? WHERE audio_source_key = ?").run(Date.now(), row.audio_source_key);
        orphanDbCount++;
      }
    }
    if (orphanDbCount > 0) console.log(`[CacheManager] DB에서 파일 없는 항목 ${orphanDbCount}건 마킹`);

    // 3. DB에서 추적하지 않는 오디오 파일 삭제
    this._cleanOrphanFiles();

    // 4. 제한 초과 시 제거
    await this.evictIfNeeded();
  }

  _cleanOrphanFiles() {
    const cacheDir = this._cacheDir;
    if (!fs.existsSync(cacheDir)) return;

    const dbPaths = new Set(
      this.db
        .prepare("SELECT file_path FROM audio_cache WHERE status = 'cached' AND file_path IS NOT NULL")
        .all()
        .map((r) => path.resolve(r.file_path)),
    );

    // 보호 대상: 저장된 세션 + 실시간 재생/사전 캐시 키
    const sessionFiles = this.getProtectedCacheFiles();
    const liveFiles = new Set([...this._protectedKeys].map((k) => path.resolve(this.getFilePath(k))));
    const allProtected = new Set([...sessionFiles, ...liveFiles]);

    let cleaned = 0;
    for (const file of fs.readdirSync(cacheDir)) {
      if (!file.endsWith(".opus")) continue;
      const full = path.resolve(path.join(cacheDir, file));
      if (!dbPaths.has(full) && !allProtected.has(full)) {
        try {
          fs.unlinkSync(full);
          cleaned++;
        } catch {
          /* 무시 */
        }
      }
    }
    if (cleaned > 0) console.log(`[CacheManager] 고아 파일 ${cleaned}개 삭제`);
  }

  // 제거

  /** CACHE_DIR 파일시스템의 디스크 여유 공간(바이트). 오류 시 Infinity 반환. */
  _diskFree() {
    try {
      const stat = fs.statfsSync(CACHE_DIR);
      return stat.bavail * stat.bsize;
    } catch {
      return Infinity;
    }
  }

  _cacheSize() {
    return this.db.prepare("SELECT COALESCE(SUM(file_size_bytes),0) AS t FROM audio_cache WHERE status='cached'").get().t;
  }

  _cacheCount() {
    return this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached'").get().c;
  }

  async evictIfNeeded() {
    if (!this._initialized) this.initialize();
    const cfg = require("../config").cache;

    const totalSize = this._cacheSize();
    const fileCount = this._cacheCount();
    const diskFree = this._diskFree();

    const overSize = totalSize > cfg.maxSizeBytes;
    const overFiles = fileCount > cfg.maxFiles;
    const lowDisk = diskFree < cfg.minFreeDiskBytes;

    if (!overSize && !overFiles && !lowDisk) return;

    if (lowDisk) {
      console.warn(`[CacheManager] ⚠️  디스크 여유 공간 부족 (${Math.round(diskFree / 1024 / 1024)}MB 남음), 강제 퇴거`);
    } else {
      console.log(`[CacheManager] 캐시 한도 도달 (${Math.round(totalSize / 1024 / 1024)}MB / ${cfg.maxSizeBytes / 1024 / 1024}MB, ${fileCount}개), 퇴거 시작...`);
    }

    await this.evict();
  }

  async evict() {
    if (!this._initialized) this.initialize();

    // 현재 보호 중인 키 제외 (재생 중/사전 캐시됨)
    const rows = this.db
      .prepare("SELECT * FROM audio_cache WHERE status = 'cached'")
      .all()
      .filter((r) => !this._protectedKeys.has(r.audio_source_key));

    if (rows.length === 0) return;

    const now = Date.now();

    const scored = rows
      .map((r) => {
        const ageDays = (now - (r.last_played_at || r.downloaded_at || r.created_at || now)) / 86_400_000;

        // 최근성: 지수 감쇠, 특성 시간 7일
        const recency = Math.exp(-ageDays / 7);

        // 빈도: 재생 횟수 합계를 나이에 따라 감쇠 (반감기 60일)
        // 오래된 재생은 최근 재생보다 낮게 계산
        const freq = Math.min(1, ((r.play_count || 0) * Math.exp(-ageDays / 60)) / 10);

        // 크기: 고정 50 MB 기준
        const sizeFrac = Math.min(1, (r.file_size_bytes || 0) / SIZE_REF_BYTES);

        // 한 번도 재생되지 않은 파일에 추가 페널티
        const neverPlayed = (r.play_count || 0) === 0 ? 0.15 : 0;

        // 점수가 높을수록 더 먼저 제거
        const score = Math.min(1, (1 - recency) * W_RECENCY + (1 - freq) * W_FREQUENCY + sizeFrac * W_SIZE + neverPlayed);

        return { ...r, _score: score };
      })
      .sort((a, b) => b._score - a._score);

    // 하위 20% 제거, 실행당 최대 50개
    const target = Math.min(Math.ceil(rows.length * 0.2), 50);
    let evicted = 0;
    for (const row of scored.slice(0, target)) {
      const fp = row.file_path || this.getFilePath(row.audio_source_key);
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch {
        /* 무시 */
      }
      this.db.prepare("DELETE FROM audio_cache WHERE audio_source_key = ?").run(row.audio_source_key);
      evicted++;
    }
    if (evicted > 0) console.log(`[CacheManager] ${evicted}개 파일 퇴거 완료`);
  }

  /** 백그라운드 주기적 제거 타이머 시작 */
  _startPeriodicEviction() {
    const cfg = require("../config").cache;
    if (this._evictInterval) clearInterval(this._evictInterval);
    this._evictInterval = setInterval(() => {
      this.evictIfNeeded().catch((err) => console.error("[CacheManager] 주기적 퇴거 오류:", err.message));
    }, cfg.evictIntervalMs);
    this._evictInterval.unref(); // 프로세스 종료를 막지 않음
  }

  // 통계

  getCacheStats() {
    if (!this._initialized) this.initialize();
    const cfg = require("../config").cache;

    const totalSize = this._cacheSize();
    const fileCount = this._cacheCount();
    const diskFree = this._diskFree();

    const totalPlays = this.db.prepare("SELECT COALESCE(SUM(play_count),0) AS t FROM audio_cache WHERE status='cached'").get().t;
    const totalDuration = this.db.prepare("SELECT COALESCE(SUM(duration_sec),0) AS t FROM audio_cache WHERE status='cached'").get().t;
    const downloading = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='downloading'").get().c;
    const lookupCount = this.db.prepare("SELECT COUNT(*) AS c FROM track_lookup").get().c;
    const neverPlayed = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND (play_count IS NULL OR play_count=0)").get().c;

    const ytCount = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND audio_source_key LIKE 'yt:%'").get().c;
    const scCount = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND audio_source_key LIKE 'sc:%'").get().c;
    const dlCount = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND audio_source_key LIKE 'dl:%'").get().c;

    const topTracks = this.db.prepare("SELECT title, channel, play_count, duration_sec FROM audio_cache WHERE status='cached' AND play_count > 0 ORDER BY play_count DESC LIMIT 5").all();

    const recentTracks = this.db.prepare("SELECT title, channel, downloaded_at FROM audio_cache WHERE status='cached' AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 3").all();

    return {
      fileCount,
      maxFiles: cfg.maxFiles,
      totalSize,
      maxSize: cfg.maxSizeBytes,
      diskFree,
      minFreeDisk: cfg.minFreeDiskBytes,
      totalPlays,
      totalDuration,
      downloading,
      lookupCount,
      neverPlayed,
      platforms: { youtube: ytCount, soundcloud: scCount, direct: dlCount },
      protectedCount: this._protectedKeys.size,
      topTracks,
      recentTracks,
    };
  }

  // ── SponsorBlock 세그먼트 캐시 (폴백 전용) ─────────────────────────────────

  /** videoId의 캐시된 원시 세그먼트 반환 — { segments: [...], fetchedAt } 또는 null */
  getSponsorSegments(videoId) {
    if (!videoId) return null;
    const row = this.db.prepare("SELECT data_json, fetched_at FROM sponsorblock_cache WHERE video_id = ?").get(videoId);
    if (!row) return null;
    try {
      return { segments: JSON.parse(row.data_json), fetchedAt: row.fetched_at };
    } catch {
      return null; // 손상된 캐시는 무시 (다음 라이브 조회가 덮어씀)
    }
  }

  /** videoId의 원시 세그먼트 write-through 저장 (빈 배열도 저장 — "구간 없음" 네거티브 캐시) */
  setSponsorSegments(videoId, segments) {
    if (!videoId || !Array.isArray(segments)) return;
    this.db
      .prepare(
        `INSERT INTO sponsorblock_cache (video_id, data_json, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
      )
      .run(videoId, JSON.stringify(segments), Date.now());
  }

  // 생명주기

  close() {
    if (this._evictInterval) {
      clearInterval(this._evictInterval);
      this._evictInterval = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
      this._initialized = false;
    }
  }
}

module.exports = new CacheManager();
