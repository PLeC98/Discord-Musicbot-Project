// 오디오 링크 데이터(track_lookup). 요청 키 → 보여 줄 링크 · 음원 주소 · 표시 정보.
// 캐시 파일은 두 걸음으로 찾는다. 링크 데이터 행의 음원 주소에서 키를 계산하고, 그 키로 audio_cache 를 본다.

import fs from "fs";
import { cacheDb } from "./cache-db.ts";
import * as audioCache from "./audio-cache.ts";
import { canonicalUrl } from "../rules/canonical-url.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import { LookupRow, checked } from "./rows.ts";
import { DONE, GONE, changedTo, type Guarded } from "./guarded-write.ts";
import type { TrackInfo } from "../player/track.ts";

/** 캐시 파일로 만든 트랙. 여기 필드는 링크 데이터와 캐시에서 온다 */
type CachedTrack = TrackInfo & { audioUrl: string };
type CacheHit = { hit: false } | { hit: true; track: CachedTrack; audioKey: string; filePath: string };

// 열기 전에 부르면 던진다
const conn = () => cacheDb.get();

// 읽기

function rowOf(requestKey: string) {
  return checked(LookupRow, conn().prepare("SELECT * FROM track_lookup WHERE request_key = ?").get(canonicalUrl(requestKey)), "링크 데이터");
}

/**
 * 요청을 캐시 파일과 곡 정보로 바꾼다. 사용자가 입력한 링크면 다듬어서 찾는다.
 * 없으면 { hit: false }, 있으면 { hit: true, track, audioKey, filePath }
 */
function resolveFromCache(requestKey: string): CacheHit {
  const row = rowOf(requestKey);
  const audioKey = row && audioKeyOf(row.audio_url);
  const cached = audioKey && audioCache.lookupByAudioKey(audioKey);
  if (!row || !audioKey || !cached || cached.status !== "cached") return { hit: false };

  const filePath = cached.file_path || audioCache.getFilePath(audioKey);
  if (!fs.existsSync(filePath)) {
    conn().prepare(`UPDATE audio_cache SET status = 'error', file_path = NULL WHERE audio_key = ?`).run(audioKey);
    return { hit: false };
  }

  const cachedTrack: CachedTrack = {
    pageUrl: row.page_url,
    requestKey: row.request_key,
    audioUrl: row.audio_url,
    // 음원이 요청 그대로면 given, 다르면 링크 데이터가 기억하는 자동 결과(스포티파이 링크). 죽었으면 다시 찾는다
    audioFoundBy: audioKeyOf(row.audio_url) === audioKeyOf(row.request_key) ? "given" : "ledger",
    platform: row.platform,
    // 행의 빈 열은 곡 모양으로(세션 복원과 같다)
    title: row.display_title || cached.title || null,
    artist: row.display_artist || cached.channel || undefined,
    thumbnail: row.display_thumbnail,
    duration: cached.duration_sec ?? 0,
  };
  return { hit: true, track: cachedTrack, audioKey, filePath };
}

// 쓰기(track_lookup)

// 표시 열을 고치는 규칙. 확인된 제목은 확인된 제목으로만 덮는다(아래 recordTrackLookup)
const DISPLAY_SET = `
              display_title     = CASE WHEN excluded.title_verified = 1 OR track_lookup.title_verified = 0
                                       THEN excluded.display_title ELSE track_lookup.display_title END,
              display_artist    = CASE WHEN excluded.title_verified = 1 OR track_lookup.title_verified = 0
                                       THEN excluded.display_artist ELSE track_lookup.display_artist END,
              display_thumbnail = CASE WHEN excluded.display_thumbnail IS NOT NULL
                                       THEN excluded.display_thumbnail ELSE track_lookup.display_thumbnail END,
              title_verified    = MAX(track_lookup.title_verified, excluded.title_verified)`;

/**
 * "이 요청은 이 음원이다"와 표시용 메타데이터 기록. 음원 주소가 정해진 곡만 적는다. 곡이 음원을 어떻게 알았나(audioFoundBy)로 가른다:
 *   pinned  쓰지 않는다. 지정을 해제하면 자동 결과로 돌아가야 한다
 *   ledger  행을 새로 만들지 않는다. 행의 음원이 곡의 음원과 같을 때만 표시 열을 고친다. 그새 새로 찾았거나(다른 음원) 운영자가 지웠으면(행 없음)
 *           옛 곡이 그 결과를 되살리지 않는다
 *   그 밖   넣거나 바꾼다. 음원이 요청과 다르면(자동으로 찾은 결과) 넣은 뒤 그 곡을 ledger 로 표시한다. 다음에 다시 틀거나 저장 세션에서 돌아와도 위 규칙을 따른다
 *
 * `verified`는 "제목을 음원 자체에서 확인했는가"다(유튜브는 영상 자체, 직접 링크는 파일 태그). 재생목록 페이지가 주는 제목은 같은 영상인데도
 * 다를 수 있어(실측: 같은 영상인데 재생목록은 앞에 전각 공백이 붙은 축약 제목을, 영상 자체는
 * 정식 제목을 준다), 직접 링크는 태그를 읽기 전에 파일 이름이 제목이다. 그걸로 확인된
 * 제목을 덮으면 한 번 고친 것이 도로 낡은 값으로 돌아간다. 그래서 확인된 제목은 확인된
 * 제목으로만 갱신한다.
 */
function recordTrackLookup(track: Partial<TrackInfo> | null | undefined, { verified = false } = {}) {
  if (!track?.requestKey || !track.audioUrl || track.audioFoundBy === "pinned") return;
  const values = [canonicalUrl(track.requestKey), track.pageUrl || track.requestKey, track.audioUrl, track.platform || "unknown", track.title || null, track.artist || null, track.thumbnail || null, verified ? 1 : 0];
  if (track.audioFoundBy === "ledger") {
    // 행이 있고 음원이 같을 때만 표시 열을 고친다. 아니면 아무것도 하지 않는다
    conn()
      .prepare(
        `
          UPDATE track_lookup SET
              display_title     = CASE WHEN @verified = 1 OR title_verified = 0 THEN @title ELSE display_title END,
              display_artist    = CASE WHEN @verified = 1 OR title_verified = 0 THEN @artist ELSE display_artist END,
              display_thumbnail = COALESCE(@thumbnail, display_thumbnail),
              title_verified    = MAX(title_verified, @verified)
          WHERE request_key = @key AND audio_url = @audio
      `,
      )
      .run({ key: values[0], audio: track.audioUrl, title: values[4], artist: values[5], thumbnail: values[6], verified: values[7] });
    return;
  }
  conn()
    .prepare(
      `
          INSERT INTO track_lookup
              (request_key, page_url, audio_url, platform, display_title, display_artist, display_thumbnail,
               title_verified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(request_key) DO UPDATE SET
              page_url          = excluded.page_url,
              audio_url         = excluded.audio_url,${DISPLAY_SET}
      `,
    )
    .run(...values);
  if (audioKeyOf(track.audioUrl) !== audioKeyOf(track.requestKey)) track.audioFoundBy = "ledger";
}

/** 링크 데이터가 기억하는 이 요청의 표시 정보(직접 지정한 음원으로 곡을 만들 때 원래 링크를 다시 읽지 않으려고). 없으면 null */
function displayOf(requestKey: string): Pick<TrackInfo, "title" | "artist" | "thumbnail" | "pageUrl" | "requestKey" | "platform"> | null {
  const row = rowOf(requestKey);
  return row ? { title: row.display_title, artist: row.display_artist ?? undefined, thumbnail: row.display_thumbnail, pageUrl: row.page_url, requestKey: row.request_key, platform: row.platform } : null;
}

/** 음원 자체에서 확인된 제목만 돌려준다. 없으면 null. 재생목록이 준 제목은 여기 안 걸린다. */
function getVerifiedTitle(requestKey: string): string | null {
  const row = rowOf(requestKey);
  return row?.title_verified ? row.display_title : null;
}

/**
 * 이 요청의 음원 주소만 조회 (파일 검증 없음). 유튜브 재검색 스킵용(Tier-1).
 * resolveFromCache와 달리 오디오 파일 존재를 요구하지 않는다. 파일이 퇴거됐어도 링크 데이터는 남는다.
 */
function getAudioUrl(requestKey: string): string | null {
  return rowOf(requestKey)?.audio_url ?? null;
}

/**
 * 이 곡의 음원을 다운로드해 둔 적이 있으면 그 음원을 잰 길이(초). 없으면 null.
 * 음원 주소가 있으면 그것으로, 없으면(영상을 아직 못 찾은 스포티파이 곡) 링크 데이터가 기억하는 음원 주소로 찾는다
 */
function knownAudioLength(track: Partial<Pick<TrackInfo, "audioUrl" | "requestKey">>): number | null {
  const audioUrl = track.audioUrl || (track.requestKey ? rowOf(track.requestKey)?.audio_url : null);
  const key = audioKeyOf(audioUrl);
  const cached = key ? audioCache.lookupByAudioKey(key) : null;
  return cached?.status === "cached" && cached.duration_sec && cached.duration_sec > 0 ? cached.duration_sec : null;
}

/** 링크 데이터 행 전부(캐시 DB 화면의 읽기). 모양이 틀린 행은 뺀다 */
function allRows(): LookupRow[] {
  return conn()
    .prepare("SELECT * FROM track_lookup")
    .all()
    .flatMap((row) => checked(LookupRow, row, "링크 데이터") ?? []);
}

/** 자동 검색 결과 삭제(캐시 DB 화면). 행의 음원이 본 값일 때만 삭제한다. 다음에 그 요청을 틀면 다시 찾는다 */
function clearResult(requestKey: string, expect: string): Guarded<string> {
  if (conn().prepare("DELETE FROM track_lookup WHERE request_key = ? AND audio_url = ?").run(canonicalUrl(requestKey), expect).changes) return DONE;
  const current = getAudioUrl(requestKey);
  return current === null ? GONE : changedTo(current);
}

/** 들여오는 링크 데이터 행(오디오 캐시 불러오기) */
type MergeRow = { requestKey: string; pageUrl: string; audioUrl: string; platform: string; title: string | null; artist: string | null; thumbnail: string | null; titleVerified: boolean };

/**
 * 오디오 캐시 불러오기: 링크 데이터를 합친다. 이 봇에 없는 요청만 넣고, 있으면 이 봇의 행을 둔다(더 새 결과).
 * 음원이 같으면 표시 열만 recordTrackLookup 의 규칙으로(확인된 제목을 앞세운다). 새로 넣은 수
 */
function mergeRows(rows: MergeRow[]): number {
  const has = conn().prepare("SELECT 1 FROM track_lookup WHERE request_key = ?").pluck();
  const upsert = conn().prepare(`
          INSERT INTO track_lookup (request_key, page_url, audio_url, platform, display_title, display_artist, display_thumbnail, title_verified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(request_key) DO UPDATE SET${DISPLAY_SET}
          WHERE track_lookup.audio_url = excluded.audio_url`);
  return conn().transaction(() => {
    let added = 0;
    for (const row of rows) {
      const key = canonicalUrl(row.requestKey);
      if (!has.get(key)) added++;
      upsert.run(key, row.pageUrl, row.audioUrl, row.platform, row.title, row.artist, row.thumbnail, row.titleVerified ? 1 : 0);
    }
    return added;
  })();
}

/** 죽은 음원을 가리키는 행 삭제. 링크 데이터에서 가져온 영상이 내려간 경우 재검색 전에 호출. */
function removeResolution(requestKey: string) {
  conn().prepare("DELETE FROM track_lookup WHERE request_key = ?").run(canonicalUrl(requestKey));
}

export { resolveFromCache, recordTrackLookup, displayOf, getVerifiedTitle, getAudioUrl, knownAudioLength, allRows, mergeRows, clearResult, removeResolution };
export type { CachedTrack, CacheHit, MergeRow };
