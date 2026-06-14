'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH  = path.join(__dirname, '..', 'database', 'cache.db');
const CACHE_DIR = path.join(__dirname, '..', 'audio_cache');

// Eviction scoring weights
const W_RECENCY   = 0.40;
const W_FREQUENCY = 0.40;
const W_SIZE      = 0.20;
// Fixed size reference: opus 128kbps ≈ 1 MB/min → 50 MB ≈ 50 min
const SIZE_REF_BYTES = 50 * 1024 * 1024;

class CacheManager {
    constructor() {
        this.db           = null;
        this._initialized = false;
        this._protectedKeys  = new Set(); // audio_source_keys currently playing / pre-cached
        this._evictInterval  = null;
        this._cacheDir       = CACHE_DIR; // overridable in tests
    }

    // ---------------------------------------------------------------------------
    // Initialisation
    // ---------------------------------------------------------------------------

    initialize() {
        if (this._initialized) return;

        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir))    fs.mkdirSync(dbDir,    { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

        this.db = new Database(DB_PATH);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('busy_timeout = 5000');

        this._createTables();
        this._initialized = true;
        this._startPeriodicEviction();
        console.log('[CacheManager] SQLite DB 초기화 완료');
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

            CREATE INDEX IF NOT EXISTS idx_ac_status      ON audio_cache(status);
            CREATE INDEX IF NOT EXISTS idx_ac_last_played ON audio_cache(last_played_at);
            CREATE INDEX IF NOT EXISTS idx_tl_audio_key   ON track_lookup(audio_source_key);
        `);
    }

    // ---------------------------------------------------------------------------
    // Static helpers
    // ---------------------------------------------------------------------------

    static md5(str) {
        return crypto.createHash('md5').update(String(str)).digest('hex');
    }

    /** Deterministic file path for an audio_source_key */
    getFilePath(audioSourceKey) {
        return path.join(CACHE_DIR, `track_${CacheManager.md5(audioSourceKey)}.opus`);
    }

    // ---------------------------------------------------------------------------
    // Live protection (playing / pre-cached tracks)
    // ---------------------------------------------------------------------------

    /** Mark a key as in-use — eviction will skip it */
    protect(audioSourceKey) {
        if (audioSourceKey) this._protectedKeys.add(audioSourceKey);
    }

    /** Release a key when it is no longer needed */
    unprotect(audioSourceKey) {
        if (audioSourceKey) this._protectedKeys.delete(audioSourceKey);
    }

    // ---------------------------------------------------------------------------
    // Lookup (read)
    // ---------------------------------------------------------------------------

    /**
     * Resolve a source URL to a cached file path + track metadata.
     * Returns { hit: false } or { hit: true, track, audioSourceKey, filePath }
     */
    _normalizeSourceUrl(sourceUrl) {
        if (typeof sourceUrl !== 'string') return sourceUrl;
        if (!sourceUrl.includes('youtube.com') && !sourceUrl.includes('youtu.be')) return sourceUrl;
        // Lazy-require to avoid circular dependency issues
        const YouTube = require('./YouTube');
        const videoId = YouTube.extractVideoId(sourceUrl);
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : sourceUrl;
    }

    resolveFromCache(sourceUrl) {
        if (!this._initialized) this.initialize();
        sourceUrl = this._normalizeSourceUrl(sourceUrl);

        const row = this.db.prepare(`
            SELECT tl.source_url, tl.platform, tl.display_title, tl.display_artist, tl.display_thumbnail,
                   ac.audio_source_key, ac.status, ac.file_path, ac.duration_sec,
                   ac.title, ac.channel
            FROM track_lookup tl
            JOIN audio_cache ac ON tl.audio_source_key = ac.audio_source_key
            WHERE tl.source_url = ?
        `).get(sourceUrl);

        if (!row || row.status !== 'cached') return { hit: false };

        const filePath = row.file_path || this.getFilePath(row.audio_source_key);
        if (!fs.existsSync(filePath)) {
            this.db.prepare(`UPDATE audio_cache SET status = 'error', file_path = NULL, updated_at = ? WHERE audio_source_key = ?`)
                .run(Date.now(), row.audio_source_key);
            return { hit: false };
        }

        const cachedTrack = {
            url:             row.source_url,
            platform:        row.platform,
            title:           row.display_title  || row.title,
            artist:          row.display_artist || row.channel,
            thumbnail:       row.display_thumbnail,
            duration:        row.duration_sec,
            audioSourceKey:  row.audio_source_key,
            _cachedFilePath: filePath,
        };

        if (row.platform === 'spotify' && row.audio_source_key.startsWith('yt:')) {
            cachedTrack.youtubeUrl = `https://www.youtube.com/watch?v=${row.audio_source_key.slice(3)}`;
        }

        return { hit: true, track: cachedTrack, audioSourceKey: row.audio_source_key, filePath };
    }

    /** Raw lookup by audio_source_key */
    lookupByAudioKey(audioSourceKey) {
        if (!this._initialized) this.initialize();
        return this.db.prepare('SELECT * FROM audio_cache WHERE audio_source_key = ?').get(audioSourceKey) || null;
    }

    // ---------------------------------------------------------------------------
    // Write — audio_cache
    // ---------------------------------------------------------------------------

    recordDownloadStart(audioSourceKey, track) {
        if (!this._initialized) this.initialize();
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO audio_cache
                (audio_source_key, status, duration_sec, title, channel,
                 verification_policy, created_at, updated_at)
            VALUES (?, 'downloading', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(audio_source_key) DO UPDATE SET
                status     = 'downloading',
                updated_at = excluded.updated_at
        `).run(
            audioSourceKey,
            track?.duration || null,
            track?.title    || null,
            track?.artist   || track?.channel || null,
            this._verificationPolicy(audioSourceKey),
            now, now
        );
    }

    recordDownloadComplete(audioSourceKey, filePath, fileSizeBytes, track) {
        if (!this._initialized) this.initialize();
        const now = Date.now();
        this.db.prepare(`
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
        `).run(
            filePath,
            fileSizeBytes,
            track?.title    || null,
            track?.artist   || track?.channel || null,
            track?.duration || null,
            `size:${fileSizeBytes}`,
            now, now, now,
            audioSourceKey
        );

        // Post-download eviction check (non-blocking)
        setImmediate(() => this.evictIfNeeded().catch(() => {}));
    }

    recordError(audioSourceKey) {
        if (!this._initialized) this.initialize();
        this.db.prepare(`UPDATE audio_cache SET status = 'error', updated_at = ? WHERE audio_source_key = ?`)
            .run(Date.now(), audioSourceKey);
    }

    recordPlayback(audioSourceKey) {
        if (!this._initialized) this.initialize();
        const now = Date.now();
        this.db.prepare(`
            UPDATE audio_cache SET play_count = play_count + 1, last_played_at = ?, updated_at = ?
            WHERE audio_source_key = ?
        `).run(now, now, audioSourceKey);
    }

    // ---------------------------------------------------------------------------
    // Write — track_lookup
    // ---------------------------------------------------------------------------

    recordTrackLookup(sourceUrl, platform, audioSourceKey, displayTitle, displayArtist, displayThumbnail) {
        if (!this._initialized) this.initialize();
        sourceUrl = this._normalizeSourceUrl(sourceUrl);
        const now = Date.now();
        this.db.prepare(`
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
        `).run(
            sourceUrl,
            audioSourceKey,
            platform,
            displayTitle     || null,
            displayArtist    || null,
            displayThumbnail || null,
            now, now
        );
    }

    // ---------------------------------------------------------------------------
    // Verification policy
    // ---------------------------------------------------------------------------

    _verificationPolicy(audioSourceKey) {
        if (audioSourceKey.startsWith('sc:')) return 'periodic';   // 24 h
        if (audioSourceKey.startsWith('dl:')) return 'always';     // every play
        return 'infrequent';                                        // 30 d (yt:*)
    }

    /** Returns true if the cached entry should be re-verified before playback */
    shouldVerify(cacheRow) {
        if (!cacheRow) return true;
        const policy      = cacheRow.verification_policy;
        const lastVerified = cacheRow.last_verified_at || 0;
        const age          = Date.now() - lastVerified;

        if (policy === 'always')     return true;
        if (policy === 'periodic')   return age > 24 * 60 * 60 * 1000;
        if (policy === 'infrequent') return age > 30 * 24 * 60 * 60 * 1000;
        return false;
    }

    // ---------------------------------------------------------------------------
    // Player sessions
    // ---------------------------------------------------------------------------

    savePlayerSession(guildId, state) {
        if (!this._initialized) this.initialize();
        this.db.prepare(`
            INSERT INTO player_sessions (guild_id, state_json, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
        `).run(guildId, JSON.stringify(state), Date.now());
    }

    getPlayerSession(guildId) {
        if (!this._initialized) this.initialize();
        const row = this.db.prepare('SELECT state_json FROM player_sessions WHERE guild_id = ?').get(guildId);
        if (!row) return null;
        try { return JSON.parse(row.state_json); } catch { return null; }
    }

    removePlayerSession(guildId) {
        if (!this._initialized) this.initialize();
        this.db.prepare('DELETE FROM player_sessions WHERE guild_id = ?').run(guildId);
    }

    getAllPlayerSessions() {
        if (!this._initialized) this.initialize();
        const rows = this.db.prepare('SELECT guild_id, state_json FROM player_sessions').all();
        const result = {};
        for (const row of rows) {
            try { result[row.guild_id] = JSON.parse(row.state_json); } catch { /* skip */ }
        }
        return result;
    }

    /** File paths referenced in saved sessions — for startup orphan cleanup */
    getProtectedCacheFiles() {
        const sessions = this.getAllPlayerSessions();
        const files = new Set();
        for (const state of Object.values(sessions)) {
            for (const f of (state.downloadedFiles || [])) {
                if (f) files.add(path.resolve(f));
            }
            if (state.currentDownloadedFile) files.add(path.resolve(state.currentDownloadedFile));
        }
        return files;
    }

    // ---------------------------------------------------------------------------
    // Startup cleanup
    // ---------------------------------------------------------------------------

    async onStartup() {
        if (!this._initialized) this.initialize();

        // 1. Reset rows interrupted mid-download
        const resetCount = this.db.prepare(
            "UPDATE audio_cache SET status = 'error', updated_at = ? WHERE status = 'downloading'"
        ).run(Date.now()).changes;
        if (resetCount > 0) console.log(`[CacheManager] 인터럽트된 다운로드 ${resetCount}건 초기화`);

        // 2. Verify cached rows still have files on disk
        const cachedRows = this.db.prepare("SELECT audio_source_key, file_path FROM audio_cache WHERE status = 'cached'").all();
        let orphanDbCount = 0;
        for (const row of cachedRows) {
            const fp = row.file_path || this.getFilePath(row.audio_source_key);
            if (!fs.existsSync(fp)) {
                this.db.prepare("UPDATE audio_cache SET status = 'error', file_path = NULL, updated_at = ? WHERE audio_source_key = ?")
                    .run(Date.now(), row.audio_source_key);
                orphanDbCount++;
            }
        }
        if (orphanDbCount > 0) console.log(`[CacheManager] DB에서 파일 없는 항목 ${orphanDbCount}건 마킹`);

        // 3. Delete audio files not tracked in DB
        this._cleanOrphanFiles();

        // 4. Evict if over limits
        await this.evictIfNeeded();
    }

    _cleanOrphanFiles() {
        const cacheDir = this._cacheDir;
        if (!fs.existsSync(cacheDir)) return;

        const dbPaths = new Set(
            this.db.prepare("SELECT file_path FROM audio_cache WHERE status = 'cached' AND file_path IS NOT NULL").all()
                .map(r => path.resolve(r.file_path))
        );

        // Protect: saved sessions + live playing/pre-cached keys
        const sessionFiles = this.getProtectedCacheFiles();
        const liveFiles    = new Set([...this._protectedKeys].map(k => path.resolve(this.getFilePath(k))));
        const allProtected = new Set([...sessionFiles, ...liveFiles]);

        let cleaned = 0;
        for (const file of fs.readdirSync(cacheDir)) {
            if (!file.endsWith('.opus')) continue;
            const full = path.resolve(path.join(cacheDir, file));
            if (!dbPaths.has(full) && !allProtected.has(full)) {
                try { fs.unlinkSync(full); cleaned++; } catch { /* ignore */ }
            }
        }
        if (cleaned > 0) console.log(`[CacheManager] 고아 파일 ${cleaned}개 삭제`);
    }

    // ---------------------------------------------------------------------------
    // Eviction
    // ---------------------------------------------------------------------------

    /** Disk free space for the CACHE_DIR filesystem (bytes). Returns Infinity on error. */
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
        const cfg = require('../config').cache;

        const totalSize = this._cacheSize();
        const fileCount = this._cacheCount();
        const diskFree  = this._diskFree();

        const overSize  = totalSize > cfg.maxSizeBytes;
        const overFiles = fileCount > cfg.maxFiles;
        const lowDisk   = diskFree  < cfg.minFreeDiskBytes;

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

        // Exclude currently protected keys (playing / pre-cached)
        const rows = this.db.prepare("SELECT * FROM audio_cache WHERE status = 'cached'").all()
            .filter(r => !this._protectedKeys.has(r.audio_source_key));

        if (rows.length === 0) return;

        const now = Date.now();

        const scored = rows.map(r => {
            const ageDays = (now - (r.last_played_at || r.downloaded_at || r.created_at || now)) / 86_400_000;

            // Recency: exponential decay, characteristic time 7 days
            const recency = Math.exp(-ageDays / 7);

            // Frequency: total plays decayed by age (60-day half-life)
            // Old plays count for less than recent ones
            const freq = Math.min(1, (r.play_count || 0) * Math.exp(-ageDays / 60) / 10);

            // Size: fixed 50 MB reference
            const sizeFrac = Math.min(1, (r.file_size_bytes || 0) / SIZE_REF_BYTES);

            // Extra penalty for never-played files
            const neverPlayed = (r.play_count || 0) === 0 ? 0.15 : 0;

            // Higher score → evict sooner
            const score = Math.min(1,
                (1 - recency) * W_RECENCY +
                (1 - freq)    * W_FREQUENCY +
                sizeFrac      * W_SIZE +
                neverPlayed
            );

            return { ...r, _score: score };
        }).sort((a, b) => b._score - a._score);

        // Evict bottom 20 %, capped at 50 per run
        const target = Math.min(Math.ceil(rows.length * 0.2), 50);
        let evicted = 0;
        for (const row of scored.slice(0, target)) {
            const fp = row.file_path || this.getFilePath(row.audio_source_key);
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ignore */ }
            this.db.prepare('DELETE FROM audio_cache WHERE audio_source_key = ?').run(row.audio_source_key);
            evicted++;
        }
        if (evicted > 0) console.log(`[CacheManager] ${evicted}개 파일 퇴거 완료`);
    }

    /** Start background periodic eviction timer */
    _startPeriodicEviction() {
        const cfg = require('../config').cache;
        if (this._evictInterval) clearInterval(this._evictInterval);
        this._evictInterval = setInterval(() => {
            this.evictIfNeeded().catch(err =>
                console.error('[CacheManager] 주기적 퇴거 오류:', err.message)
            );
        }, cfg.evictIntervalMs);
        this._evictInterval.unref(); // Don't block process exit
    }

    // ---------------------------------------------------------------------------
    // Stats
    // ---------------------------------------------------------------------------

    getCacheStats() {
        if (!this._initialized) this.initialize();
        const cfg = require('../config').cache;

        const totalSize  = this._cacheSize();
        const fileCount  = this._cacheCount();
        const diskFree   = this._diskFree();

        const totalPlays    = this.db.prepare("SELECT COALESCE(SUM(play_count),0) AS t FROM audio_cache WHERE status='cached'").get().t;
        const totalDuration = this.db.prepare("SELECT COALESCE(SUM(duration_sec),0) AS t FROM audio_cache WHERE status='cached'").get().t;
        const downloading   = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='downloading'").get().c;
        const lookupCount   = this.db.prepare("SELECT COUNT(*) AS c FROM track_lookup").get().c;
        const neverPlayed   = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND (play_count IS NULL OR play_count=0)").get().c;

        const ytCount = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND audio_source_key LIKE 'yt:%'").get().c;
        const scCount = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND audio_source_key LIKE 'sc:%'").get().c;
        const dlCount = this.db.prepare("SELECT COUNT(*) AS c FROM audio_cache WHERE status='cached' AND audio_source_key LIKE 'dl:%'").get().c;

        const topTracks = this.db.prepare(
            "SELECT title, channel, play_count, duration_sec FROM audio_cache WHERE status='cached' AND play_count > 0 ORDER BY play_count DESC LIMIT 5"
        ).all();

        const recentTracks = this.db.prepare(
            "SELECT title, channel, downloaded_at FROM audio_cache WHERE status='cached' AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 3"
        ).all();

        return {
            fileCount,
            maxFiles:        cfg.maxFiles,
            totalSize,
            maxSize:         cfg.maxSizeBytes,
            diskFree,
            minFreeDisk:     cfg.minFreeDiskBytes,
            totalPlays,
            totalDuration,
            downloading,
            lookupCount,
            neverPlayed,
            platforms:       { youtube: ytCount, soundcloud: scCount, direct: dlCount },
            protectedCount:  this._protectedKeys.size,
            topTracks,
            recentTracks,
        };
    }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    close() {
        if (this._evictInterval) { clearInterval(this._evictInterval); this._evictInterval = null; }
        if (this.db) { this.db.close(); this.db = null; this._initialized = false; }
    }
}

module.exports = new CacheManager();
