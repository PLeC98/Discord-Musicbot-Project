// 외부 서비스의 응답을 담아 두는 표. SponsorBlock 구간, 연령 제한 영상, 스포티파이 익명 상태

import { cacheDb } from "./cache-db.ts";
import { DONE, GONE, changedTo, type Guarded } from "./guarded-write.ts";

// JSON 을 담아 둔 한 행
type JsonRow = { data_json: string; fetched_at: number };
// SponsorBlock 구간 한 행: 받은 주소를 함께 둔다
type SponsorRow = JsonRow & { api_base: string | null };
/** 오디오 캐시 내보내기 파일의 SponsorBlock 구간 한 행. data는 담아 둔 원시 JSON 문자열 그대로 */
type SponsorExport = { videoId: string; data: string; fetchedAt: number; apiBase: string | null };

// 열기 전에 부르면 던진다
const conn = () => cacheDb.get();

// ── SponsorBlock 구간 캐시 ──

/** videoId의 캐시된 원시 세그먼트와 받은 때, 주소. 없거나 망가졌으면 null */
function getSponsorSegments(videoId: string | null | undefined): { segments: unknown; fetchedAt: number; apiBase: string | null } | null {
  if (!videoId) return null;
  const row = conn().prepare("SELECT data_json, fetched_at, api_base FROM sponsorblock_cache WHERE video_id = ?").get(videoId) as SponsorRow | undefined;
  if (!row) return null;
  try {
    return { segments: JSON.parse(row.data_json) as unknown, fetchedAt: row.fetched_at, apiBase: row.api_base };
  } catch {
    return null; // 망가진 캐시는 없는 것으로 본다(다음 조회가 덮어쓴다)
  }
}

/** videoId의 원시 세그먼트를 받은 때, 주소와 함께 저장한다. 빈 배열도 저장한다("구간 없음"도 캐시한다) */
function setSponsorSegments(videoId: string | null | undefined, segments: unknown, { fetchedAt, apiBase }: { fetchedAt: number; apiBase: string }) {
  if (!videoId || !Array.isArray(segments)) return;
  conn()
    .prepare(
      `INSERT INTO sponsorblock_cache (video_id, data_json, fetched_at, api_base) VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at, api_base = excluded.api_base`,
    )
    .run(videoId, JSON.stringify(segments), fetchedAt, apiBase);
}

/** SponsorBlock 구간 전부(오디오 캐시 내보내기) */
function allSponsorSegments(): SponsorExport[] {
  return (conn().prepare("SELECT video_id, data_json, fetched_at, api_base FROM sponsorblock_cache").all() as Array<SponsorRow & { video_id: string }>).map((row) => ({ videoId: row.video_id, data: row.data_json, fetchedAt: row.fetched_at, apiBase: row.api_base }));
}

/** 오디오 캐시 불러오기: SponsorBlock 구간을 합친다(없으면 넣고, 있으면 더 새로 받은 쪽). 새로 넣은 수 */
function mergeSponsorSegments(rows: SponsorExport[]): number {
  const has = conn().prepare("SELECT 1 FROM sponsorblock_cache WHERE video_id = ?").pluck();
  const upsert = conn().prepare(
    `INSERT INTO sponsorblock_cache (video_id, data_json, fetched_at, api_base) VALUES (?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at, api_base = excluded.api_base WHERE excluded.fetched_at > sponsorblock_cache.fetched_at`,
  );
  return conn().transaction(() => {
    let added = 0;
    for (const row of rows) {
      if (!has.get(row.videoId)) added++;
      upsert.run(row.videoId, row.data, row.fetchedAt, row.apiBase);
    }
    return added;
  })();
}

// ── 연령 제한 기록 ──

/** videoId 를 연령 제한으로 기록한다. 다시 찾을 때 곧바로 쿠키로 가고, 캐시 파일이 퇴거돼도 기록은 남는다 */
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

/** 연령 제한 기록을 삭제한다(캐시 DB 화면). 표시한 때가 본 값일 때만. 다음 재생은 쿠키 없이 먼저 해 보고 다시 표시한다 */
function clearAgeRestricted(videoId: string, expect: number): Guarded<number> {
  if (conn().prepare("DELETE FROM age_restricted WHERE video_id = ? AND marked_at = ?").run(videoId, expect).changes) return DONE;
  const current = conn().prepare("SELECT marked_at FROM age_restricted WHERE video_id = ?").pluck().get(videoId) as number | undefined;
  return current === undefined ? GONE : changedTo(current);
}

/** 오디오 캐시 불러오기: 연령 제한 기록을 합친다(표시한 때는 먼저 표시한 쪽). 새로 넣은 수 */
function mergeAgeRestricted(rows: Array<{ videoId: string; markedAt: number }>): number {
  const insert = conn().prepare("INSERT INTO age_restricted (video_id, marked_at) VALUES (?, ?) ON CONFLICT(video_id) DO UPDATE SET marked_at = MIN(age_restricted.marked_at, excluded.marked_at)");
  const has = conn().prepare("SELECT 1 FROM age_restricted WHERE video_id = ?").pluck();
  return conn().transaction(() => {
    let added = 0;
    for (const row of rows) {
      if (!has.get(row.videoId)) added++;
      insert.run(row.videoId, row.markedAt);
    }
    return added;
  })();
}

// ── 스포티파이 익명 웹 플레이어 상태 ──
// secret, 해시, clientVersion. 오래됐거나 토큰, 해시 오류가 나면 sources/spotify 가 다시 추출해 덮어쓴다.
// 같은 행에 익명 토큰(token: { value, expiresAt })을 따로 둔다. 다시 시작해도 만료 전이면 그대로 쓴다. 상태를 덮어써도 토큰은 남긴다

type AnonToken = { value: string; expiresAt: number };

function anonRow(): JsonRow | undefined {
  return conn().prepare("SELECT data_json, fetched_at FROM spotify_anon WHERE id = 1").get() as JsonRow | undefined;
}

function anonData(row: JsonRow | undefined): Record<string, unknown> | null {
  if (!row) return null;
  try {
    return JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 저장된 익명 상태 `{ ...data, fetchedAt }`(토큰은 빼고). 없거나 망가졌으면 null */
function getSpotifyAnonState(): (Record<string, unknown> & { fetchedAt: number }) | null {
  const row = anonRow();
  const data = anonData(row);
  if (!row || !data) return null;
  const { token: _token, ...state } = data;
  return { ...state, fetchedAt: row.fetched_at };
}

/** 익명 상태를 저장한다(행 하나를 덮어쓰고 저장된 토큰은 남긴다). data 는 JSON 으로 직렬화할 수 있는 객체 */
function setSpotifyAnonState(data: Record<string, unknown>) {
  const token = anonData(anonRow())?.token;
  conn()
    .prepare("INSERT INTO spotify_anon (id, data_json, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at")
    .run(JSON.stringify(token ? { ...data, token } : data), Date.now());
}

/** 저장된 익명 토큰. 없거나 모양이 틀리면 null(만료는 부르는 쪽이 본다) */
function getSpotifyAnonToken(): AnonToken | null {
  const token = anonData(anonRow())?.token as Partial<AnonToken> | undefined;
  return typeof token?.value === "string" && typeof token.expiresAt === "number" ? { value: token.value, expiresAt: token.expiresAt } : null;
}

/** 익명 토큰을 저장한다. null 이면 삭제한다. 상태 행이 없으면(토큰은 상태로 받는다) 저장하지 않는다. 상태를 추출한 시각은 그대로 */
function setSpotifyAnonToken(token: AnonToken | null) {
  const data = anonData(anonRow());
  if (!data) return;
  const { token: _old, ...rest } = data;
  conn()
    .prepare("UPDATE spotify_anon SET data_json = ? WHERE id = 1")
    .run(JSON.stringify(token ? { ...rest, token } : rest));
}

export { getSponsorSegments, setSponsorSegments, allSponsorSegments, mergeSponsorSegments, markAgeRestricted, isAgeRestricted, allAgeRestricted, clearAgeRestricted, mergeAgeRestricted, getSpotifyAnonState, setSpotifyAnonState, getSpotifyAnonToken, setSpotifyAnonToken };
