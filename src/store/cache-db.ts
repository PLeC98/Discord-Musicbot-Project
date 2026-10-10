// 캐시 DB(cache.db). 다시 받거나 다시 찾으면 되살아나는 것만 담는다: 받은 곡 색인 · 링크 장부 · 바깥 서비스의 답.
// 구조 버전이 바뀌면 묻지 않고 표를 새로 만든다. 색인을 잃은 곡 파일은 기동 정리(audioCache.onStartup)가 지운다.
// 캐시 초기화는 이 파일의 표를 모두 비운다(audioCache.resetCache). 사람이 정한 값 · 실행 상태는 여기 두지 않는다.

import { DbFile } from "./sqlite.ts";
import type { Db } from "./sqlite.ts";

const cacheDb = new DbFile({
  label: "캐시 DB",
  fileName: "cache.db",
  // 6: 서버 설정 · 저장된 대기열 · 음성 채널 상태를 다른 파일로 옮겼다
  version: 6,
  synchronous: "NORMAL",
  onMismatch: "recreate",
  createTables,
});

function createTables(db: Db) {
  db.exec(`
            -- 받아 둔 소리 하나. 열쇠는 audioKeyOf(음원 주소)다(yt:<id> · sc:<경로> · dl:<md5>).
            -- audio_version: 원본의 버전(유튜브 lmt, 직접 링크 ETag 등). 같은 주소에서 음원이 바뀐 것을 알아볼 값
            CREATE TABLE IF NOT EXISTS audio_cache (
                audio_key           TEXT PRIMARY KEY,
                status              TEXT NOT NULL DEFAULT 'downloading',
                file_path           TEXT,
                file_size_bytes     INTEGER,
                duration_sec        REAL,
                title               TEXT,
                channel             TEXT,
                audio_version       TEXT,
                version_checked_at  INTEGER,
                play_count          INTEGER NOT NULL DEFAULT 0,
                last_played_at      INTEGER,
                downloaded_at       INTEGER,
                created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );

            -- 링크 장부. "이 요청은 이 음원이다". 파일이 있든 없든 참이라 퇴거해도 남는다.
            -- 캐시 열쇠는 적지 않는다. 쓸 때 audioKeyOf(audio_url) 로 계산한다
            CREATE TABLE IF NOT EXISTS track_lookup (
                request_key         TEXT PRIMARY KEY,
                page_url            TEXT NOT NULL,
                audio_url           TEXT NOT NULL,
                platform            TEXT NOT NULL,
                display_title       TEXT,
                display_artist      TEXT,
                display_thumbnail   TEXT,
                -- 제목의 출처: 1=영상 자체에서 확인, 0=재생목록 페이지 등 간접 출처.
                -- 재생목록이 주는 제목은 낡을 수 있어(같은 영상인데 다르다), 확인된 제목을 덮으면 안 된다.
                title_verified      INTEGER NOT NULL DEFAULT 0
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
        `);
}

export { cacheDb, createTables };
