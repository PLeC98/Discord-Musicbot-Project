"use strict";

// 링크 장부(track_lookup). 요청 열쇠 → 보여 줄 링크 · 음원 주소 · 표시 정보.
// 캐시 파일은 두 걸음으로 찾는다. 장부 줄의 음원 주소에서 열쇠를 계산하고, 그 열쇠로 audio_cache 를 본다.

const fs = require("fs");
const db = require("./db");
const audioCache = require("./audioCache");
const { canonicalUrl } = require("../rules/canonicalUrl");
const { audioKeyOf } = require("../rules/audioKeyOf");

class TrackLookup {
  get db() {
    return db.get();
  }

  // 조회 (읽기)

  _row(requestKey) {
    return this.db.prepare("SELECT * FROM track_lookup WHERE request_key = ?").get(canonicalUrl(requestKey)) || null;
  }

  /**
   * 요청을 받아 둔 파일과 트랙 정보로. 사용자가 넣은 링크면 다듬어서 찾는다.
   * { hit: false } 또는 { hit: true, track, audioKey, filePath }를 반환합니다.
   */
  resolveFromCache(requestKey) {
    const row = this._row(requestKey);
    const audioKey = row && audioKeyOf(row.audio_url);
    const cached = audioKey && audioCache.lookupByAudioKey(audioKey);
    if (!cached || cached.status !== "cached") return { hit: false };

    const filePath = cached.file_path || audioCache.getFilePath(audioKey);
    if (!fs.existsSync(filePath)) {
      this.db.prepare(`UPDATE audio_cache SET status = 'error', file_path = NULL, updated_at = ? WHERE audio_key = ?`).run(Date.now(), audioKey);
      return { hit: false };
    }

    const cachedTrack = {
      pageUrl: row.page_url,
      requestKey: row.request_key,
      audioUrl: row.audio_url,
      platform: row.platform,
      title: row.display_title || cached.title,
      artist: row.display_artist || cached.channel,
      thumbnail: row.display_thumbnail,
      duration: cached.duration_sec,
    };
    return { hit: true, track: cachedTrack, audioKey, filePath };
  }

  // 쓰기. track_lookup

  /**
   * "이 요청은 이 음원이다"와 표시용 메타데이터 기록. 음원 주소가 정해진 곡만 적는다.
   *
   * `verified`는 "제목을 영상 자체에서 확인했는가"다. 재생목록 페이지가 주는 제목은 같은 영상인데도
   * 다를 수 있어(실측: 같은 영상인데 재생목록은 앞에 전각 공백이 붙은 축약 제목을, 영상 자체는
   * 정식 제목을 준다), 그걸로 확인된
   * 제목을 덮으면 한 번 고친 것이 도로 낡은 값으로 돌아간다. 그래서 확인된 제목은 확인된
   * 제목으로만 갱신한다. 음원 주소와 보여 줄 링크는 출처와 무관하게 항상 갱신한다.
   */
  recordTrackLookup(track, { verified = false } = {}) {
    if (!track?.requestKey || !track.audioUrl) return;
    const now = Date.now();
    const v = verified ? 1 : 0;
    this.db
      .prepare(
        `
            INSERT INTO track_lookup
                (request_key, page_url, audio_url, platform, display_title, display_artist, display_thumbnail,
                 title_verified, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(request_key) DO UPDATE SET
                page_url          = excluded.page_url,
                audio_url         = excluded.audio_url,
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
      .run(canonicalUrl(track.requestKey), track.pageUrl || track.requestKey, track.audioUrl, track.platform || "unknown", track.title || null, track.artist || null, track.thumbnail || null, v, now, now);
  }

  /** 영상 자체에서 확인된 제목만 돌려준다. 없으면 null. 재생목록이 준 제목은 여기 안 걸린다. */
  getVerifiedTitle(requestKey) {
    const row = this._row(requestKey);
    return row?.title_verified ? row.display_title : null;
  }

  /**
   * 이 요청의 음원 주소만 조회 (파일 검증 없음). 유튜브 재검색 스킵용(Tier-1).
   * resolveFromCache와 달리 오디오 파일 존재를 요구하지 않는다. 파일이 퇴거됐어도 장부는 남는다.
   */
  getAudioUrl(requestKey) {
    return this._row(requestKey)?.audio_url ?? null;
  }

  /** 죽은 음원을 가리키는 줄 삭제. 장부에서 가져온 영상이 내려간 경우 재검색 전에 호출. */
  removeResolution(requestKey) {
    this.db.prepare("DELETE FROM track_lookup WHERE request_key = ?").run(canonicalUrl(requestKey));
  }
}

module.exports = new TrackLookup();
