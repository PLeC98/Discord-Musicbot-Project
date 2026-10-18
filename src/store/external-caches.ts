// 외부 서비스의 응답을 담아 두는 표. SponsorBlock 구간 · 연령 제한 영상 · 스포티파이 익명 상태

import { cacheDb } from "./cache-db.ts";
import { DONE, GONE, changedTo, type Guarded } from "./guarded-write.ts";

// JSON 을 담아 둔 한 행
type JsonRow = { data_json: string; fetched_at: number };

// 열기 전에 부르면 던진다
const conn = () => cacheDb.get();

// ── SponsorBlock 세그먼트 캐시 (폴백 전용) ─────────────────────────────────

/** videoId의 캐시된 원시 세그먼트 반환. { segments: [...], fetchedAt } 또는 null */
function getSponsorSegments(videoId: string | null | undefined): { segments: unknown; fetchedAt: number } | null {
  if (!videoId) return null;
  const row = conn().prepare("SELECT data_json, fetched_at FROM sponsorblock_cache WHERE video_id = ?").get(videoId) as JsonRow | undefined;
  if (!row) return null;
  try {
    return { segments: JSON.parse(row.data_json) as unknown, fetchedAt: row.fetched_at };
  } catch {
    return null; // 손상된 캐시는 무시 (다음 라이브 조회가 덮어씀)
  }
}

/** videoId의 원시 세그먼트 write-through 저장 (빈 배열도 저장. "구간 없음" 네거티브 캐시) */
function setSponsorSegments(videoId: string | null | undefined, segments: unknown) {
  if (!videoId || !Array.isArray(segments)) return;
  conn()
    .prepare(
      `INSERT INTO sponsorblock_cache (video_id, data_json, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at`,
    )
    .run(videoId, JSON.stringify(segments), Date.now());
}

// ── 연령 제한 videoId 레지스트리 ───────────────────────────────────────────

/** videoId를 연령 제한으로 기록 (재조회 시 쿠키 폴백 직행 + 퇴거 잔존용) */
function markAgeRestricted(videoId: string | null | undefined) {
  if (!videoId) return;
  conn().prepare("INSERT INTO age_restricted (video_id, marked_at) VALUES (?, ?) ON CONFLICT(video_id) DO NOTHING").run(videoId, Date.now());
}

/** videoId가 연령 제한으로 알려져 있는가 */
function isAgeRestricted(videoId: string | null | undefined) {
  if (!videoId) return false;
  return !!conn().prepare("SELECT 1 FROM age_restricted WHERE video_id = ?").get(videoId);
}

/** 연령 제한 기록 전부(캐시 DB 화면의 읽기) */
function allAgeRestricted(): Array<{ videoId: string; markedAt: number }> {
  return (conn().prepare("SELECT video_id, marked_at FROM age_restricted").all() as Array<{ video_id: string; marked_at: number }>).map((row) => ({ videoId: row.video_id, markedAt: row.marked_at }));
}

/** 연령 제한 표시를 지운다(캐시 DB 화면). 표시한 때가 본 값일 때만. 다음 재생은 쿠키 없이 먼저 해 보고 다시 표시한다 */
function clearAgeRestricted(videoId: string, expect: number): Guarded<number> {
  if (conn().prepare("DELETE FROM age_restricted WHERE video_id = ? AND marked_at = ?").run(videoId, expect).changes) return DONE;
  const current = conn().prepare("SELECT marked_at FROM age_restricted WHERE video_id = ?").pluck().get(videoId) as number | undefined;
  return current === undefined ? GONE : changedTo(current);
}

// Spotify 익명 웹플레이어 상태 (secret/해시/clientVersion). 자가치유 캐시

/** 저장된 익명 상태 반환 (없으면 null). `{ ...data, fetchedAt }` */
function getSpotifyAnonState(): (Record<string, unknown> & { fetchedAt: number }) | null {
  const row = conn().prepare("SELECT data_json, fetched_at FROM spotify_anon WHERE id = 1").get() as JsonRow | undefined;
  if (!row) return null;
  try {
    return { ...(JSON.parse(row.data_json) as Record<string, unknown>), fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

/** 익명 상태 저장(단일 행 upsert). data는 JSON 직렬화 가능한 객체. */
function setSpotifyAnonState(data: unknown) {
  conn().prepare("INSERT INTO spotify_anon (id, data_json, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at").run(JSON.stringify(data), Date.now());
}

export { getSponsorSegments, setSponsorSegments, markAgeRestricted, isAgeRestricted, allAgeRestricted, clearAgeRestricted, getSpotifyAnonState, setSpotifyAnonState };
