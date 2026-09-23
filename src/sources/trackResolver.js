"use strict";

// TrackResolver. 쿼리/트랙의 플랫폼 감지, 메타데이터 조회, 스트림 해석

const YouTube = require("./youtube/index");
const log = require("../infra/log/logger").child({ category: "track" });
const Spotify = require("./spotify");
const SoundCloud = require("./soundcloud");
const DirectLink = require("./direct");
const CacheManager = require("../store/cacheManager");
const ErrorHandler = require("../ui/errorMessages");
const { buildSearchQueries, mergeCandidateLists, rankCandidates } = require("./youtube/match");

const TrackResolver = {
  // 쿼리 문자열의 플랫폼 판별. direct 판정은 DirectLink.isDirectAudioLink 한 곳 기준
  detectPlatform(query) {
    if (YouTube.isYouTubeURL(query)) return "youtube";
    if (Spotify.isSpotifyURL(query)) return "spotify";
    if (SoundCloud.isSoundCloudURL(query)) return "soundcloud";
    if (DirectLink.isDirectAudioLink(query)) return "direct";
    return "youtube"; // 기본값은 YouTube 검색
  },

  /**
   * 유튜브 링크이긴 한데 우리가 아는 형태가 아닌가 (클립·채널·검색 결과 페이지 등).
   *
   * 이런 주소를 검색으로 흘리면 URL 문자열 자체가 검색어가 되어 엉뚱한 영상이 재생되기에 재생을 거절한다.
   * (클립은 2026년 유튜브가 기능을 없앴다. 지원 대상이 아니다.)
   */
  isUnsupportedYouTubeLink(query) {
    return YouTube.isYouTubeHost(query) && !YouTube.isYouTubeURL(query);
  },

  // 쿼리 → { success, isPlaylist, collection, tracks, total, nextOffset } 또는 { success: false, message }
  // collection: 여러 곡을 담은 출처의 종류. "playlist" | "album" | "artist", 한 곡이면 null
  // range: 여러 곡 출처에서 받을 구간 { offset, limit }. 한 곡이면 무시. total은 모르면 null.
  async getTrackData(query, context = "TrackResolver.getTrackData", { offset = 0, limit } = {}) {
    try {
      let tracks = [];
      let isPlaylist = false;
      let collection = null;
      let total = null;
      let nextOffset = null;

      switch (this.detectPlatform(query)) {
        case "youtube":
          if (YouTube.isPlaylist(query)) {
            const playlistData = await YouTube.getPlaylist(query, { offset, limit });
            if (playlistData && playlistData.tracks && playlistData.tracks.length > 0) {
              tracks = playlistData.tracks;
              isPlaylist = true;
              collection = "playlist";
              total = playlistData.total ?? null;
              nextOffset = playlistData.nextOffset ?? null;
            } else {
              // 재생목록을 불러오지 못하면 일반 검색 수행
              tracks = await YouTube.search(query, 1);
            }
          } else if (this.isUnsupportedYouTubeLink(query)) {
            return { success: false, message: "❌ 재생할 수 없는 유튜브 주소입니다." };
          } else {
            tracks = await YouTube.search(query, 1);
          }
          break;

        case "spotify":
          if (Spotify.isSpotifyURL(query)) {
            const part = await Spotify.getCollection(query, { offset, limit });
            tracks = part.tracks || [];
            const { type } = Spotify.parseSpotifyURL(query);
            isPlaylist = type === "playlist" || type === "album" || type === "artist";
            if (isPlaylist) {
              collection = type;
              total = part.total ?? null;
              nextOffset = part.nextOffset ?? null;
            }
          } else {
            tracks = (await Spotify.search(query, 1)) || [];
          }
          break;

        case "soundcloud":
          tracks = (await SoundCloud.search(query, 1)) || [];
          break;

        case "direct":
          tracks = await DirectLink.getInfo(query); // 배열 계약: [track] 또는 []
          break;
      }

      if (!tracks || tracks.length === 0) {
        return { success: false, message: "❌ 결과를 찾을 수 없습니다!" };
      }

      return { success: true, isPlaylist, collection, tracks, total, nextOffset };
    } catch (error) {
      const errorMsg = ErrorHandler.handle(error, context);
      return { success: false, message: errorMsg };
    }
  },

  // 여러 곡 출처의 구간만. 이어 넣기용. getTrackData와 달리 못 받으면 검색으로 넘어가지 않는다
  // (유튜브는 목록 끝을 넘는 구간이면 항목이 비어 getPlaylist가 null이다).
  async getCollection(url, range) {
    const none = { tracks: [], total: null, nextOffset: null };
    if (YouTube.isPlaylist(url)) {
      const r = await YouTube.getPlaylist(url, range);
      return r ? { tracks: r.tracks, total: r.total ?? null, nextOffset: r.nextOffset ?? null } : none;
    }
    if (Spotify.isSpotifyURL(url)) return Spotify.getCollection(url, range);
    return none;
  },

  /**
   * 캐시 숏컷 포함 해석. 캐시된 단일 곡은 yt-dlp 호출 없이 즉시 반환.
   * 재생목록 URL은 캐시를 우회: URL 정규화가 list=를 제거하므로 캐시된 단일 영상이 재생목록 전체를 가릴 수 있음.
   * 지원하지 않는 형태의 유튜브 링크도 우회한다. 예전에 검색으로 흘러 잘못 맺힌 매핑이 남아 있으면
   * 캐시가 그 엉뚱한 영상을 그대로 돌려준다.
   */
  async resolveQuery(query, context, range = {}) {
    const skipCache = YouTube.isPlaylist(query) || this.isUnsupportedYouTubeLink(query);
    const cacheHit = skipCache ? { hit: false } : CacheManager.resolveFromCache(query);
    if (cacheHit.hit) {
      return { success: true, isPlaylist: false, tracks: [cacheHit.track] };
    }
    return this.getTrackData(query, context, range);
  },

  /**
   * 트랙의 공유 캐시 키(audioSourceKey) 산출. yt/sc/direct는 즉시, spotify는 YouTube 동등물이 정해진 뒤에만 가능(findYouTubeEquivalent가 설정).
   * 이미 키가 있으면 그대로 둔다.
   */
  ensureAudioSourceKey(track) {
    if (!track) return null;
    if (track.audioSourceKey) return track.audioSourceKey;

    if (track.platform === "youtube") {
      const vid = track.id || YouTube.extractVideoId(track.url);
      if (vid) track.audioSourceKey = `yt:${vid}`;
    } else if (track.platform === "soundcloud" && track.id) {
      track.audioSourceKey = `sc:${track.id}`;
    } else if (track.platform === "direct") {
      track.audioSourceKey = `dl:${CacheManager.md5(track.url)}`;
    } else if (track.youtubeUrl) {
      // 스포티파이와, 자동재생이 출처에서 받아 온 곡들(lastfm·lbradio·vocadb 계열 …).
      // 출처가 달라도 같은 영상이면 음원 파일 하나를 함께 쓴다.
      const vid = YouTube.extractVideoId(track.youtubeUrl);
      if (vid) track.audioSourceKey = `yt:${vid}`;
    }
    return track.audioSourceKey || null;
  },

  /**
   * Spotify/SoundCloud 트랙의 YouTube 동등물 검색. 점수제 선택(src/sources/youtube/match.js).
   * 유튜브 순위 + 스포티파이 길이 일치를 지배 신호로, 채널일치·정크를 타이브레이커로 삼아
   * 원곡/커버/리믹스/TV size 등을 올바로 구분한다. 성공 시 track.youtubeUrl(및 audioSourceKey)을
   * 설정하고 URL 반환, 실패 시 null.
   */
  async findYouTubeEquivalent(track) {
    if (track.youtubeUrl) {
      this.ensureAudioSourceKey(track);
      return track.youtubeUrl;
    }

    // Tier-1: 이미 해결된 매핑이 있으면 유튜브 검색을 건너뛴다(파일 존재 여부 무관).
    // 매핑의 영상이 내려간 경우는 소비(다운로드) 시점에서 감지해 reresolveYouTube로 재검색한다.
    if (track.url) {
      const cachedKey = CacheManager.getResolvedKey(track.url);
      if (cachedKey && cachedKey.startsWith("yt:")) {
        track.audioSourceKey = cachedKey;
        track.youtubeUrl = `https://www.youtube.com/watch?v=${cachedKey.slice(3)}`;
        track._youtubeFromCache = true; // 소비 시 unavailable이면 재검색 트리거
        return track.youtubeUrl;
      }
    }

    // 타겟: 스포티파이 duration(초)을 durationSec로 넘겨야 길이 신호가 동작한다
    const target = { title: track.title, artist: track.artist, durationSec: Number(track.duration) || 0 };
    const { primary, secondary } = buildSearchQueries(target);

    const runGroup = async (queries) => {
      const lists = [];
      for (const query of queries) {
        try {
          const results = await YouTube.search(query, 6);
          lists.push(
            (results || []).map((r) => ({
              id: r.id,
              url: r.url || (r.id ? `https://www.youtube.com/watch?v=${r.id}` : null),
              title: r.title,
              channel: r.artist, // YouTube.search는 채널명을 artist 필드에 담는다
              durationSec: r.duration,
              isLive: r.isLive,
            })),
          );
        } catch {
          lists.push([]); // 한 쿼리 실패가 전체를 막지 않게
        }
      }
      return lists;
    };

    // 라이브 방송은 후보에서 제외한다. 동등물로서 언제나 오답인 데다(원곡이 라이브일 리 없다),
    // 일단 선택되면 캐시 다운로드가 끝나지 않아 ffmpeg가 무한히 파일을 불린다.
    // 제목이 기호뿐인 곡처럼 신호가 약한 경우 duration 0인 라이브가 우승하는 일이 실제로 있었다.
    const candidates = mergeCandidateLists(await runGroup(primary), await runGroup(secondary)).filter((c) => c.url && !c.isLive);
    if (!candidates.length) return null;

    const { best } = rankCandidates(candidates, target);
    if (!best || !best.url) return null;

    track.youtubeUrl = best.url;
    track.youtubeTitle = best.title;
    this.ensureAudioSourceKey(track);
    return track.youtubeUrl;
  },

  /**
   * 캐시 매핑의 유튜브 영상이 내려간 경우: 스테일 매핑을 삭제하고 새로 검색한다.
   * 재검색 결과는 _youtubeFromCache가 아니므로(신규 검색), 다시 실패해도 이 경로가 재발동하지 않는다(무한루프 방지).
   */
  async reresolveYouTube(track) {
    if (track.url) CacheManager.removeResolution(track.url);
    track.youtubeUrl = null;
    track.youtubeTitle = null;
    track.audioSourceKey = null;
    track._youtubeFromCache = false;
    return this.findYouTubeEquivalent(track);
  },

  /**
   * 재생용 스트림 획득. 플랫폼 스위치 단일화.
   * spotify는 YouTube 동등물을 먼저 확보(track.youtubeUrl 재사용)한 뒤 YouTube로 위임.
   */
  async getStream(track, seekSeconds = 0) {
    switch (track.platform) {
      case "youtube":
        return YouTube.getStream(track.url, seekSeconds);

      case "spotify": {
        let ytUrl = await this.findYouTubeEquivalent(track);
        if (!ytUrl) throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${track.title}`);
        try {
          return await YouTube.getStream(ytUrl, seekSeconds);
        } catch (err) {
          // 캐시 매핑의 영상이 내려간 경우(프리로드·즉시재생 스트리밍이 여기서 먼저 실패) → 재검색 후 1회 재시도.
          if (YouTube.isVideoUnavailableError(err) && track._youtubeFromCache) {
            log.warn({ tags: ["retry"] }, `캐시된 유튜브 영상 접근 불가 (${track.title}). 재검색 후 재시도`);
            ytUrl = await this.reresolveYouTube(track);
            if (ytUrl) return await YouTube.getStream(ytUrl, seekSeconds);
          }
          throw err;
        }
      }

      case "soundcloud":
        return SoundCloud.getStream(track.url);

      case "direct":
        // URL 서술자만 반환. 실제 fetch는 소비 시점에 DirectLink.getStream(SafeUrl 가드)이
        // 수행한다. 여기서 스트림을 미리 열면 프리로드가 연결을 열고 버리는 누수·이중소비가 생긴다.
        return { url: track.url, platform: "direct", httpHeaders: {} };

      default:
        // 자동재생이 출처에서 받아 온 곡(lastfm·lbradio·vocadb·animethemes …)은 표시 정보만
        // 출처 것이고 소리는 유튜브에서 온다. 고를 때 영상을 이미 찾아 두었으므로 그대로 쓴다
        // 스포티파이와 달리 여기서 다시 찾지 않는다.
        if (track.youtubeUrl) return YouTube.getStream(track.youtubeUrl, seekSeconds);
        // AnimeThemes처럼 출처 이름을 platform 에 쓰면서 음원을 직접 받는 곡.
        // 위의 "direct"와 같은 처지이므로 같은 서술자를 돌려준다.
        if (DirectLink.isDirectAudioLink(track.url)) return { url: track.url, platform: "direct", httpHeaders: {} };
        throw new Error(`지원되지 않는 플랫폼: ${track.platform}`);
    }
  },
};

module.exports = TrackResolver;
