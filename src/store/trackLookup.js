"use strict";

// 링크 장부(track_lookup). 소스 주소 → 캐시 열쇠 · 표시 정보

const fs = require("fs");
const db = require("./db");
const audioCache = require("./audioCache");

class TrackLookup {
  get db() {
    return db.get();
  }

  getFilePath(audioSourceKey) {
    return audioCache.getFilePath(audioSourceKey);
  }

  // 조회 (읽기)

  /**
   * 소스 URL을 캐시된 파일 경로와 트랙 메타데이터로 해석합니다.
   * { hit: false } 또는 { hit: true, track, audioSourceKey, filePath }를 반환합니다.
   */
  _normalizeSourceUrl(sourceUrl) {
    if (typeof sourceUrl !== "string") return sourceUrl;
    // 순환 의존성 문제를 피하기 위해 지연 require
    const YouTube = require("../sources/youtube/index");
    const videoId = YouTube.extractVideoId(sourceUrl);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : sourceUrl;
  }

  resolveFromCache(sourceUrl) {
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

    // 출처가 따로 있고 소리만 유튜브에서 오는 곡(스포티파이, 그리고 자동재생의 lastfm·lbradio·
    // vocadb 계열 …)은 영상 주소를 되살려 준다. 없으면 스트림을 어디서 가져올지 알 수 없다.
    if (row.platform !== "youtube" && String(row.audio_source_key).startsWith("yt:")) {
      cachedTrack.youtubeUrl = `https://www.youtube.com/watch?v=${row.audio_source_key.slice(3)}`;
    }

    return { hit: true, track: cachedTrack, audioSourceKey: row.audio_source_key, filePath };
  }

  // 쓰기. track_lookup

  /**
   * 소스 URL → 캐시 키 매핑과 표시용 메타데이터 기록.
   *
   * `verified`는 "제목을 영상 자체에서 확인했는가"다. 재생목록 페이지가 주는 제목은 같은 영상인데도
   * 다를 수 있어(실측: 같은 영상인데 재생목록은 앞에 전각 공백이 붙은 축약 제목을, 영상 자체는
   * 정식 제목을 준다), 그걸로 확인된
   * 제목을 덮으면 한 번 고친 것이 도로 낡은 값으로 돌아간다. 그래서 확인된 제목은 확인된
   * 제목으로만 갱신한다. 매핑(audio_source_key)은 출처와 무관하게 항상 갱신한다.
   */
  recordTrackLookup(sourceUrl, platform, audioSourceKey, displayTitle, displayArtist, displayThumbnail, { verified = false } = {}) {
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

  /** 영상 자체에서 확인된 제목만 돌려준다. 없으면 null. 재생목록이 준 제목은 여기 안 걸린다. */
  getVerifiedTitle(sourceUrl) {
    const row = this.db.prepare("SELECT display_title FROM track_lookup WHERE source_url = ? AND title_verified = 1").get(this._normalizeSourceUrl(sourceUrl));
    return row?.display_title || null;
  }

  /**
   * 매핑만 조회 (파일 검증 없음). 유튜브 재검색 스킵용(Tier-1).
   * resolveFromCache와 달리 오디오 파일 존재를 요구하지 않으므로, 파일이 퇴거됐어도
   * "이 소스가 어느 audio_source_key인가"를 알려준다. 반환: audioSourceKey 또는 null.
   */
  getResolvedKey(sourceUrl) {
    const row = this.db.prepare("SELECT audio_source_key FROM track_lookup WHERE source_url = ?").get(this._normalizeSourceUrl(sourceUrl));
    return row ? row.audio_source_key : null;
  }

  /** 스테일 매핑 삭제. 캐시된 영상이 내려간 경우 재검색 전에 호출. */
  removeResolution(sourceUrl) {
    this.db.prepare("DELETE FROM track_lookup WHERE source_url = ?").run(this._normalizeSourceUrl(sourceUrl));
  }
}

module.exports = new TrackLookup();
