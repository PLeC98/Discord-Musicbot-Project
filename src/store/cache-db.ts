// 캐시 DB(cache.db). 음원 데이터를 담는다: 캐시 파일 기록 · 오디오 링크 데이터 · 직접 지정한 음원 · 재생 테스트 결과 · 외부 서비스의 응답.
// 구조 버전이 맞지 않으면 열지 않고 멈춘다(삭제하고 다시 시작하라고 안내한다). 삭제한 뒤 기록을 잃은 캐시 파일은 기동 정리(audioCache.onStartup)가 삭제한다.
// 캐시 초기화는 직접 지정한 음원(KEPT_ON_RESET) 말고 이 파일의 표를 모두 비운다(audioCache.resetCache). 직접 지정한 음원은 사람이 정한 값이지만
// "어느 요청에 어느 음원"이라는 음원 데이터라 링크 데이터와 같은 파일에 둔다(설정 스냅샷을 복원해도 따라 돌아가지 않는다). 실행 상태는 여기 두지 않는다.

import { DbFile } from "./sqlite.ts";
import type { Db } from "./sqlite.ts";

const cacheDb = new DbFile({
  label: "캐시 DB",
  fileName: "cache.db",
  // 6: 서버 설정 · 저장된 대기열 · 음성 채널 상태를 다른 파일로 옮겼다
  version: 6,
  synchronous: "NORMAL",
  onMismatch: { lost: "캐시 파일 기록 · 오디오 링크 데이터 · 직접 지정한 음원 · 재생 테스트 결과 · SponsorBlock 구간 · 연령 제한 기록이 사라지고, 캐시 파일은 시작할 때 정리가 삭제한 뒤 다음 재생부터 다시 다운로드합니다." },
  createTables,
});

function createTables(db: Db) {
  db.exec(`
            -- 캐시 파일 하나. 키는 audioKeyOf(음원 주소)다(yt:<id> · sc:<경로> · dl:<md5>).
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

            -- 오디오 링크 데이터. "이 요청은 이 음원이다". 파일이 있든 없든 참이라 퇴거해도 남는다.
            -- 캐시 키는 저장하지 않는다. 쓸 때 audioKeyOf(audio_url) 로 계산한다
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

            -- 운영자가 직접 지정한 음원. "이 요청은 이 음원으로 튼다". 곡을 찾을 때 링크 데이터보다 먼저 본다(store/pinned-sources).
            -- 키는 링크 데이터와 같은 요청 키(canonicalUrl). 사람이 정한 값이라 캐시 초기화가 건너뛴다
            CREATE TABLE IF NOT EXISTS pinned_sources (
                request_key  TEXT PRIMARY KEY,
                audio_url    TEXT NOT NULL,
                pinned_at    INTEGER NOT NULL
            );

            -- 음원 하나를 재생할 수 있는지의 마지막 결과(재생 테스트 · 직접 지정한 음원이 재생에 실패한 것). 키는 audioKeyOf(음원 주소).
            -- code: 실패 까닭(문제 코드, 라이브면 live). 성공이면 NULL
            CREATE TABLE IF NOT EXISTS source_checks (
                audio_key    TEXT PRIMARY KEY,
                ok           INTEGER NOT NULL,
                code         TEXT,
                checked_at   INTEGER NOT NULL
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

/** 캐시 초기화가 비우지 않는 표 */
const KEPT_ON_RESET: readonly string[] = ["pinned_sources"];

export { cacheDb, createTables, KEPT_ON_RESET };
