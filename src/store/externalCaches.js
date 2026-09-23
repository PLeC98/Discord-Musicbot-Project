// 바깥 서비스의 답을 담아 두는 표. SponsorBlock 구간 · 연령 제한 영상 · 스포티파이 익명 상태

import db from "./db.js";

class ExternalCaches {
  get db() {
    return db.get();
  }

  // ── SponsorBlock 세그먼트 캐시 (폴백 전용) ─────────────────────────────────

  /** videoId의 캐시된 원시 세그먼트 반환. { segments: [...], fetchedAt } 또는 null */
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

  /** videoId의 원시 세그먼트 write-through 저장 (빈 배열도 저장. "구간 없음" 네거티브 캐시) */
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
    this.db.prepare("INSERT INTO age_restricted (video_id, marked_at) VALUES (?, ?) ON CONFLICT(video_id) DO NOTHING").run(videoId, Date.now());
  }

  /** videoId가 연령 제한으로 알려져 있는가 */
  isAgeRestricted(videoId) {
    if (!videoId) return false;
    return !!this.db.prepare("SELECT 1 FROM age_restricted WHERE video_id = ?").get(videoId);
  }

  // Spotify 익명 웹플레이어 상태 (secret/해시/clientVersion). 자가치유 캐시

  /** 저장된 익명 상태 반환 (없으면 null). `{ ...data, fetchedAt }` */
  getSpotifyAnonState() {
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
    this.db.prepare("INSERT INTO spotify_anon (id, data_json, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at").run(JSON.stringify(data), Date.now());
  }
}

const exported = new ExternalCaches();
export default exported;
export { exported as "module.exports" };
