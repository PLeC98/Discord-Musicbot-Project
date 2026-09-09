"use strict";

const Database = require("better-sqlite3");
const log = require("./logger").child({ category: "cache" });
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
    this._protectedKeys = new Set(); // 현재 재생 중인 audio_source_key
    this._queuedKeys = new Map(); // guildId -> Set<audio_source_key> — 대기열 앞부분
    this._evictInterval = null;
    // 캐시 파일이 놓이는 곳. 테스트가 여기만 갈아끼우면 실제 폴더를 건드리지 않는다 —
    // 파일을 만지는 코드는 반드시 이 값을 거쳐야 한다(모듈 상수를 직접 쓰면 격리가 새어나간다).
    this._cacheDir = CACHE_DIR;
  }

  // 초기화 — dbPath는 테스트 주입용(임시 DB), 운영은 항상 기본 경로
  initialize(dbPath = DB_PATH) {
    if (this._initialized) return;

    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    if (!fs.existsSync(this._cacheDir)) fs.mkdirSync(this._cacheDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    this._createTables();
    this._initialized = true;
    this._startPeriodicEviction();
    log.info("캐시 데이터베이스 준비 완료");
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
                -- 제목의 출처: 1=영상 자체에서 확인, 0=재생목록 페이지 등 간접 출처.
                -- 재생목록이 주는 제목은 낡을 수 있어(같은 영상인데 다르다), 확인된 제목을 덮으면 안 된다.
                title_verified      INTEGER NOT NULL DEFAULT 0,
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

            -- 연령 제한 확인된 videoId — 재조회 시 bgutil 실패를 건너뛰고 바로 쿠키 폴백에 사용.
            -- 캐시 퇴거에서도 이 영상들은 더 오래 잔존시킨다(재취득이 느리고 쿠키가 필요하므로).
            CREATE TABLE IF NOT EXISTS age_restricted (
                video_id    TEXT PRIMARY KEY,
                marked_at   INTEGER NOT NULL
            );

            -- Spotify 익명 웹플레이어 상태(secret 목록/GraphQL 해시/clientVersion) 캐시.
            -- 번들에서 추출한 값을 보관하고 TTL·실패 시 재추출로 갱신(자가치유). 단일 행(id=1) JSON 블롭.
            CREATE TABLE IF NOT EXISTS spotify_anon (
                id          INTEGER PRIMARY KEY CHECK (id = 1),
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
    if (!gsCols.includes("dj_role_ids")) this.db.exec("ALTER TABLE guild_settings ADD COLUMN dj_role_ids TEXT");

    // SponsorBlock 컬럼 추가 (컬럼 도입 이전 DB 대응 — CREATE IF NOT EXISTS는 컬럼을 안 만듦)
    const gsCols2 = this.db
      .prepare("PRAGMA table_info(guild_settings)")
      .all()
      .map((c) => c.name);
    if (!gsCols2.includes("sponsorblock_enabled")) this.db.exec("ALTER TABLE guild_settings ADD COLUMN sponsorblock_enabled INTEGER");
    if (!gsCols2.includes("sponsorblock_categories")) this.db.exec("ALTER TABLE guild_settings ADD COLUMN sponsorblock_categories TEXT");

    // 제목 출처 표시 추가. 기존 행은 전부 0(미확인) — 다음에 그 영상을 받거나 재생할 때 확인된다.
    const tlCols = this.db
      .prepare("PRAGMA table_info(track_lookup)")
      .all()
      .map((c) => c.name);
    if (!tlCols.includes("title_verified")) this.db.exec("ALTER TABLE track_lookup ADD COLUMN title_verified INTEGER NOT NULL DEFAULT 0");
  }

  // 이 모듈은 인스턴스를 내보내므로 static이면 외부에서 닿지 않는다
  md5(str) {
    return crypto.createHash("md5").update(String(str)).digest("hex");
  }

  /** audio_source_key에 대한 결정적 파일 경로 */
  getFilePath(audioSourceKey) {
    return path.join(this._cacheDir, `track_${this.md5(audioSourceKey)}.opus`);
  }

  /**
   * 중단된 다운로드가 남긴 부스러기를 지운다 — `track_<md5>.opus.part`, `.part-Frag0`, `.ytdl`,
   * 트랜스코딩 전 중간 파일 등. yt-dlp의 임시 파일 이름 규칙에 기대지 않도록,
   * "완성본(.opus)과 같은 basename으로 시작하되 완성본은 아닌 파일"을 전부 대상으로 삼는다.
   *
   * 중단된 다운로드는 지금까지 아무도 치우지 않아 영구 잔류했다(_cleanOrphanFiles는 .opus만 훑는다).
   * @param {string} filepath 완성본 경로(track_<md5>.opus)
   * @returns {number} 삭제한 파일 수
   */
  cleanPartials(filepath) {
    if (!filepath) return 0;
    const dir = path.dirname(filepath);
    const base = path.basename(filepath); // track_<md5>.opus
    if (!/^track_[0-9a-f]{32}\.opus$/.test(base)) return 0; // 우리가 만든 경로가 아니면 손대지 않는다
    if (!fs.existsSync(dir)) return 0;

    const stem = base.slice(0, -".opus".length); // track_<md5>
    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
      if (name === base) continue; // 완성본은 별도 관리(_cleanOrphanFiles/evict)
      if (!name.startsWith(`${stem}.`)) continue; // 같은 트랙의 부스러기만
      try {
        fs.unlinkSync(path.join(dir, name));
        removed++;
      } catch {
        /* 아직 잠겨 있거나 이미 없음 — 다음 startup 스윕이 처리 */
      }
    }
    return removed;
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

  /**
   * 길드의 대기열 보호 집합을 통째로 교체한다.
   *
   * 추가·삭제를 개별로 추적하지 않는 것이 요점이다. 대기열이 바뀔 때마다 전체를 다시 계산해
   * 넘기므로 해제를 빠뜨려 보호가 남는 누수가 생기지 않는다.
   *
   * 길드별로 나누는 이유: 두 길드가 같은 곡을 대기열에 두었을 때 한쪽이 비운다고
   * 다른 쪽 보호까지 풀리면 안 된다.
   */
  setQueuedKeys(guildId, keys) {
    if (!guildId) return;
    const set = new Set((keys || []).filter(Boolean));
    if (set.size === 0) this._queuedKeys.delete(guildId);
    else this._queuedKeys.set(guildId, set);
  }

  /** 길드가 떠날 때 — 남은 보호를 놓는다 */
  clearQueuedKeys(guildId) {
    if (guildId) this._queuedKeys.delete(guildId);
  }

  /** 재생 중 + 모든 길드의 대기열 — 퇴거에서 제외할 키 전부 */
  _liveKeys() {
    const keys = new Set(this._protectedKeys);
    for (const set of this._queuedKeys.values()) for (const k of set) keys.add(k);
    return keys;
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

  /**
   * 소스 URL → 캐시 키 매핑과 표시용 메타데이터 기록.
   *
   * `verified`는 "제목을 영상 자체에서 확인했는가"다. 재생목록 페이지가 주는 제목은 같은 영상인데도
   * 다를 수 있어(실측: 같은 영상인데 재생목록은 앞에 전각 공백이 붙은 축약 제목을, 영상 자체는
   * 정식 제목을 준다), 그걸로 확인된
   * 제목을 덮으면 한 번 고친 것이 도로 낡은 값으로 돌아간다. 그래서 **확인된 제목은 확인된
   * 제목으로만 갱신한다.** 매핑(audio_source_key)은 출처와 무관하게 항상 갱신한다.
   */
  recordTrackLookup(sourceUrl, platform, audioSourceKey, displayTitle, displayArtist, displayThumbnail, { verified = false } = {}) {
    if (!this._initialized) this.initialize();
    sourceUrl = this._normalizeSourceUrl(sourceUrl);
    const now = Date.now();
    const v = verified ? 1 : 0;
    this.db
      .prepare(
        `
            INSERT INTO track_lookup
                (source_url, audio_source_key, platform, display_title, display_artist, display_thumbnail,
                 title_verified, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_url) DO UPDATE SET
                audio_source_key  = excluded.audio_source_key,
                display_title     = CASE WHEN excluded.title_verified = 1 OR track_lookup.title_verified = 0
                                         THEN excluded.display_title ELSE track_lookup.display_title END,
                display_artist    = CASE WHEN excluded.title_verified = 1 OR track_lookup.title_verified = 0
                                         THEN excluded.display_artist ELSE track_lookup.display_artist END,
                display_thumbnail = CASE WHEN excluded.display_thumbnail IS NOT NULL
                                         THEN excluded.display_thumbnail ELSE track_lookup.display_thumbnail END,
                title_verified    = MAX(track_lookup.title_verified, excluded.title_verified),
                updated_at        = excluded.updated_at
        `,
      )
      .run(sourceUrl, audioSourceKey, platform, displayTitle || null, displayArtist || null, displayThumbnail || null, v, now, now);
  }

  /** 영상 자체에서 확인된 제목만 돌려준다. 없으면 null — 재생목록이 준 제목은 여기 안 걸린다. */
  getVerifiedTitle(sourceUrl) {
    if (!this._initialized) this.initialize();
    const row = this.db.prepare("SELECT display_title FROM track_lookup WHERE source_url = ? AND title_verified = 1").get(this._normalizeSourceUrl(sourceUrl));
    return row?.display_title || null;
  }

  /**
   * 매핑만 조회 (파일 검증 없음) — 유튜브 재검색 스킵용(Tier-1).
   * resolveFromCache와 달리 오디오 파일 존재를 요구하지 않으므로, 파일이 퇴거됐어도
   * "이 소스가 어느 audio_source_key인가"를 알려준다. 반환: audioSourceKey 또는 null.
   */
  getResolvedKey(sourceUrl) {
    if (!this._initialized) this.initialize();
    const row = this.db.prepare("SELECT audio_source_key FROM track_lookup WHERE source_url = ?").get(this._normalizeSourceUrl(sourceUrl));
    return row ? row.audio_source_key : null;
  }

  /** 스테일 매핑 삭제 — 캐시된 영상이 내려간 경우 재검색 전에 호출. */
  removeResolution(sourceUrl) {
    if (!this._initialized) this.initialize();
    this.db.prepare("DELETE FROM track_lookup WHERE source_url = ?").run(this._normalizeSourceUrl(sourceUrl));
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
  /**
   * 저장된 세션에서 지켜야 할 캐시 파일 — 기동 시 고아 파일 청소가 쓴다.
   * 그 시점엔 플레이어가 아직 없으므로 대기열이 유일한 근거다.
   */
  getProtectedCacheFiles() {
    const sessions = this.getAllPlayerSessions();
    const files = new Set();
    for (const state of Object.values(sessions)) {
      for (const track of [state.currentTrack, ...(state.queue || [])]) {
        const key = track?.audioSourceKey;
        if (key) files.add(path.resolve(this.getFilePath(key)));
      }
      if (state.currentDownloadedFile) files.add(path.resolve(state.currentDownloadedFile));
    }
    return files;
  }

  // 서버 설정

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
    if (resetCount > 0) log.info(`지난 실행에서 중단된 다운로드 ${resetCount}건 정리 완료`);

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
    if (orphanDbCount > 0) log.info(`오디오 캐시 파일이 누락된 항목 ${orphanDbCount}건 기록 완료`);

    // 3. DB에서 추적하지 않는 오디오 파일 삭제
    this._cleanOrphanFiles();

    // 4. 제한 초과 시 제거
    await this.evictIfNeeded();
  }

  /**
   * 캐시를 초기 상태로 되돌린다 — 오디오 파일 전부와 파생 데이터 테이블.
   *
   * `guild_settings`(전용 채널·DJ 역할·SponsorBlock 설정)는 남긴다. 사용자가 손으로 넣은
   * 유일한 값이라 다시 만들 수 없고, 나머지는 전부 다시 받거나 다시 계산할 수 있다.
   *
   * 재생 중인 파일은 열려 있어 지워지지 않을 수 있다(윈도우). 실패해도 멈추지 않고 세어서
   * 돌려준다 — 재생은 이미 연 핸들로 계속되므로 끊기지 않는다.
   */
  resetCache() {
    if (!this._initialized) this.initialize();

    const before = { files: this._cacheCount(), bytes: this._cacheSize() };

    // 파생 데이터만 비운다. track_lookup은 CASCADE 대상이지만 명시해 순서를 못박는다.
    const tables = ["track_lookup", "audio_cache", "sponsorblock_cache", "age_restricted", "spotify_anon", "player_sessions"];
    const wipe = this.db.transaction(() => {
      for (const t of tables) this.db.prepare(`DELETE FROM ${t}`).run();
    });
    wipe();

    let removed = 0;
    let kept = 0;
    if (fs.existsSync(this._cacheDir)) {
      for (const file of fs.readdirSync(this._cacheDir)) {
        try {
          fs.unlinkSync(path.join(this._cacheDir, file));
          removed++;
        } catch {
          kept++; // 재생 중이라 잠긴 파일
        }
      }
    }

    // 보호 집합은 사라진 행을 가리키게 되므로 함께 비운다. 재생 중인 곡은 다음 예열 틱이 다시 채운다.
    this._protectedKeys.clear();
    this._queuedKeys.clear();

    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.exec("VACUUM");
    } catch {
      /* 파일 크기만 못 줄일 뿐 초기화는 끝났다 */
    }

    log.warn(`오디오 캐시 초기화: ${removed}개 삭제(${Math.round(before.bytes / 1024 / 1024)}MB)${kept > 0 ? `, ${kept}개는 재생 중이라 남겨둠` : ""}`);
    return { removed, kept, freedBytes: before.bytes, fileCountBefore: before.files };
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
    const liveFiles = new Set([...this._liveKeys()].map((k) => path.resolve(this.getFilePath(k))));
    const allProtected = new Set([...sessionFiles, ...liveFiles]);

    let cleaned = 0;
    let partials = 0;
    for (const file of fs.readdirSync(cacheDir)) {
      const full = path.resolve(path.join(cacheDir, file));

      // 중단된 다운로드의 부스러기(track_<md5>.opus.part, .part-FragN, .ytdl, 트랜스코딩 전 중간 파일).
      // 부팅 시점에는 진행 중인 다운로드가 없으므로 무조건 지워도 안전하다.
      // (봇을 강제 종료하면 ffmpeg가 파일 핸들을 물고 남는데, 프로세스를 정리한 뒤 남는 잔해가 이것들이다.)
      if (/^track_[0-9a-f]{32}\./.test(file) && !file.endsWith(".opus")) {
        try {
          fs.unlinkSync(full);
          partials++;
        } catch {
          /* 무시 */
        }
        continue;
      }

      if (!file.endsWith(".opus")) continue;
      if (!dbPaths.has(full) && !allProtected.has(full)) {
        try {
          fs.unlinkSync(full);
          cleaned++;
        } catch {
          /* 무시 */
        }
      }
    }
    if (cleaned > 0) log.info(`어디에도 연결되지 않은 고아 파일 ${cleaned}개 삭제 완료`);
    if (partials > 0) log.info(`캐시 다운로드 중단으로 생성된 조각 파일 ${partials}개 삭제 완료`);
  }

  // 제거

  /** CACHE_DIR 파일시스템의 디스크 여유 공간(바이트). 오류 시 Infinity 반환. */
  _diskFree() {
    try {
      const stat = fs.statfsSync(this._cacheDir);
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
      log.warn(`디스크 여유 공간 부족 (${Math.round(diskFree / 1024 / 1024)}MB 남음) — 오디오 캐시를 즉시 정리합니다.`);
    } else {
      log.info(`오디오 캐시 용량 제한 도달 (${Math.round(totalSize / 1024 / 1024)}MB / ${cfg.maxSizeBytes / 1024 / 1024}MB, ${fileCount}개) — 오래된 파일부터 정리합니다.`);
    }

    await this.evict();
  }

  async evict() {
    if (!this._initialized) this.initialize();

    // 보호 중인 키 제외 — 재생 중인 곡과 각 길드의 대기열 앞부분.
    // 대기열 곡을 빼지 않으면 방금 예열한 파일을 곧바로 도로 가져가는 일이 생긴다.
    const live = this._liveKeys();
    const rows = this.db
      .prepare("SELECT * FROM audio_cache WHERE status = 'cached'")
      .all()
      .filter((r) => !live.has(r.audio_source_key));

    if (rows.length === 0) return;

    const now = Date.now();

    // 연령 제한 영상은 재취득이 느리고 쿠키가 필요하므로 퇴거에서 더 오래 잔존시킨다(점수↓).
    const ageSet = new Set(
      this.db
        .prepare("SELECT video_id FROM age_restricted")
        .all()
        .map((r) => r.video_id),
    );

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
        let score = Math.min(1, (1 - recency) * W_RECENCY + (1 - freq) * W_FREQUENCY + sizeFrac * W_SIZE + neverPlayed);

        // 연령 제한 영상: 점수를 낮춰 잔존 우선순위를 높임 (재취득 비용↑). 절대 임계값이 아닌 상대 랭킹이라 영구보존은 아님.
        const vid = typeof r.audio_source_key === "string" && r.audio_source_key.startsWith("yt:") ? r.audio_source_key.slice(3) : null;
        if (vid && ageSet.has(vid)) score *= 0.5;

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
    if (evicted > 0) log.info(`${evicted}개의 오디오 캐시 파일 삭제 완료`);
  }

  /** 백그라운드 주기적 제거 타이머 시작 */
  _startPeriodicEviction() {
    const cfg = require("../config").cache;
    if (this._evictInterval) clearInterval(this._evictInterval);
    this._evictInterval = setInterval(() => {
      this.evictIfNeeded().catch((err) => log.error("정기적 오디오 캐시 자동 정리 중 오류:", err.message));
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
      protectedCount: this._liveKeys().size,
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

  // ── 연령 제한 videoId 레지스트리 ───────────────────────────────────────────

  /** videoId를 연령 제한으로 기록 (재조회 시 쿠키 폴백 직행 + 퇴거 잔존용) */
  markAgeRestricted(videoId) {
    if (!videoId) return;
    if (!this._initialized) this.initialize();
    this.db.prepare("INSERT INTO age_restricted (video_id, marked_at) VALUES (?, ?) ON CONFLICT(video_id) DO NOTHING").run(videoId, Date.now());
  }

  /** videoId가 연령 제한으로 알려져 있는가 */
  isAgeRestricted(videoId) {
    if (!videoId) return false;
    if (!this._initialized) this.initialize();
    return !!this.db.prepare("SELECT 1 FROM age_restricted WHERE video_id = ?").get(videoId);
  }

  // Spotify 익명 웹플레이어 상태 (secret/해시/clientVersion) — 자가치유 캐시

  /** 저장된 익명 상태 반환 (없으면 null). `{ ...data, fetchedAt }` */
  getSpotifyAnonState() {
    if (!this._initialized) this.initialize();
    const row = this.db.prepare("SELECT data_json, fetched_at FROM spotify_anon WHERE id = 1").get();
    if (!row) return null;
    try {
      return { ...JSON.parse(row.data_json), fetchedAt: row.fetched_at };
    } catch {
      return null;
    }
  }

  /** 익명 상태 저장(단일 행 upsert). data는 JSON 직렬화 가능한 객체. */
  setSpotifyAnonState(data) {
    if (!this._initialized) this.initialize();
    this.db.prepare("INSERT INTO spotify_anon (id, data_json, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at").run(JSON.stringify(data), Date.now());
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
