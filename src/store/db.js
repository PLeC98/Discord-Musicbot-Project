"use strict";

// 캐시 DB 하나. 불러와도 열리지 않는다. 기동이 open() 으로 열고, 열기 전에 get() 을 부르면 던진다.

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { createTables: createSessionTables } = require("./playerSessions");

const DB_PATH = path.join(__dirname, "..", "..", "database", "cache.db");

// DB 구조를 크게 바꿀 때마다 올린다. 맞지 않으면 열지 않고 지우라고 알린다
const SCHEMA_VERSION = 3;

let conn = null;

function open(dbPath = DB_PATH, { cacheDir } = {}) {
  if (conn) return conn;

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const next = new Database(dbPath);
  next.pragma("journal_mode = WAL");
  next.pragma("synchronous = NORMAL");
  next.pragma("foreign_keys = ON");
  next.pragma("busy_timeout = 5000");

  const hasTables = next.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n > 0;
  const version = next.pragma("user_version", { simple: true });
  if (hasTables && version !== SCHEMA_VERSION) {
    next.close();
    const message = `캐시 DB 구조가 이 버전과 맞지 않습니다 (DB v${version}, 필요 v${SCHEMA_VERSION}). 봇을 끄고 ${dbPath} (-wal, -shm 포함)와 ${cacheDir} 폴더를 지운 뒤 다시 실행하세요. 서버별 설정(전용 채널·DJ 역할·SponsorBlock·재생목록 한 번에 넣는 곡 수)은 다시 해야 합니다.`;
    throw Object.assign(new Error(message), { code: "SCHEMA_MISMATCH" });
  }

  createTables(next);
  if (!hasTables) next.pragma(`user_version = ${SCHEMA_VERSION}`);
  conn = next;
  return conn;
}

function get() {
  if (!conn) throw Object.assign(new Error("캐시 DB 를 열기 전에 불렀다(store/db.open 을 먼저)"), { code: "DB_NOT_OPEN" });
  return conn;
}

const isOpen = () => conn !== null;

function close() {
  if (!conn) return;
  conn.close();
  conn = null;
}

function createTables(db) {
  db.exec(`
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

            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id                 TEXT PRIMARY KEY,
                bot_channel_id           TEXT,
                dj_role_ids              TEXT,
                sponsorblock_enabled     INTEGER,   -- NULL=상속(전역 기본), 0/1
                sponsorblock_categories  TEXT,       -- NULL=상속, JSON 배열
                playlist_add_max         INTEGER,    -- NULL=기본값, 재생목록을 넣을 때 한 번에 들어가는 곡 수
                now_playing_channel_id   TEXT,       -- 서버당 하나뿐인 현재 재생 패널의 자리
                now_playing_message_id   TEXT,
                updated_at               INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );

            -- SponsorBlock 원시 세그먼트 캐시 (폴백 전용. 라이브 조회 실패 시 사용).
            -- data_json = 정규화 이전 원시 배열(카테고리 전부). 정규화/필터는 SponsorBlock.js가 읽을 때 수행.
            CREATE TABLE IF NOT EXISTS sponsorblock_cache (
                video_id    TEXT PRIMARY KEY,
                data_json   TEXT NOT NULL,
                fetched_at  INTEGER NOT NULL
            );

            -- 연령 제한 확인된 videoId. 재조회 시 bgutil 실패를 건너뛰고 바로 쿠키 폴백에 사용.
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

  createSessionTables(db);
}

module.exports = { open, get, isOpen, close, SCHEMA_VERSION, DB_PATH };
