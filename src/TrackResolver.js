"use strict";

/**
 * TrackResolver — 쿼리/트랙의 플랫폼 감지, 메타데이터 조회, 스트림 해석의 단일 원천.
 *
 * 기존에 흩어져 있던 중복 구현을 통합 (2026-07-07 리팩토링):
 *  - detectPlatform: play.js / playfirst.js / MusicPlayer 3벌 (direct 판정 확장자가 3·9·13종으로 제각각 — §3.2)
 *  - getTrackData: play.js / playfirst.js 복붙 2벌 + MusicPlayer.addTrack의 축소판
 *  - 캐시 숏컷: play.js / playfirst.js / messageHandler 3벌
 *  - Spotify→YouTube 검색 폴백: play() / preloadTrack() / downloadTrack() 3벌 (전략 상이 → play()의 다중 쿼리 + official 우선으로 통일)
 *  - 스트림 획득 플랫폼 스위치: play() / preloadTrack() 2벌
 */

const YouTube = require("./YouTube");
const Spotify = require("./Spotify");
const SoundCloud = require("./SoundCloud");
const DirectLink = require("./DirectLink");
const CacheManager = require("./CacheManager");
const ErrorHandler = require("./ErrorHandler");

const TrackResolver = {
  /** 쿼리 문자열의 플랫폼 판별 — direct 판정은 DirectLink.isDirectAudioLink 한 곳 기준 */
  detectPlatform(query) {
    if (query.includes("youtube.com") || query.includes("youtu.be")) return "youtube";
    if (query.includes("spotify.com")) return "spotify";
    if (query.includes("soundcloud.com")) return "soundcloud";
    if (DirectLink.isDirectAudioLink(query)) return "direct";
    return "youtube"; // 기본값은 YouTube 검색
  },

  /** 쿼리 → { success, isPlaylist, tracks } 또는 { success: false, message } */
  async getTrackData(query, guildId, context = "TrackResolver.getTrackData") {
    try {
      let tracks = [];
      let isPlaylist = false;

      switch (this.detectPlatform(query)) {
        case "youtube":
          if (YouTube.isPlaylist(query)) {
            const playlistData = await YouTube.getPlaylist(query, guildId);
            if (playlistData && playlistData.tracks && playlistData.tracks.length > 0) {
              tracks = playlistData.tracks;
              isPlaylist = true;
            } else {
              // 재생목록을 불러오지 못하면 일반 검색 수행
              tracks = await YouTube.search(query, 1, guildId);
            }
          } else {
            tracks = await YouTube.search(query, 1, guildId);
          }
          break;

        case "spotify":
          if (Spotify.isSpotifyURL(query)) {
            tracks = (await Spotify.getFromURL(query, guildId)) || [];
            const { type } = Spotify.parseSpotifyURL(query);
            isPlaylist = type === "playlist" || type === "album" || type === "artist";
          } else {
            tracks = (await Spotify.search(query, 1, "track", guildId)) || [];
          }
          break;

        case "soundcloud":
          tracks = (await SoundCloud.search(query, 1, guildId)) || [];
          break;

        case "direct":
          tracks = await DirectLink.getInfo(query); // 배열 계약: [track] 또는 []
          break;
      }

      if (!tracks || tracks.length === 0) {
        return { success: false, message: "❌ 결과를 찾을 수 없습니다!" };
      }

      return { success: true, isPlaylist, tracks };
    } catch (error) {
      const errorMsg = await ErrorHandler.handle(error, guildId, context);
      return { success: false, message: errorMsg };
    }
  },

  /**
   * 캐시 숏컷 포함 해석 — 캐시된 단일 곡은 yt-dlp 호출 없이 즉시 반환.
   * 재생목록 URL은 캐시를 우회: URL 정규화가 list=를 제거하므로 캐시된 단일 영상이
   * 재생목록 전체를 가릴 수 있음.
   */
  async resolveQuery(query, guildId, context) {
    const cacheHit = YouTube.isPlaylist(query) ? { hit: false } : CacheManager.resolveFromCache(query);
    if (cacheHit.hit) {
      return { success: true, isPlaylist: false, tracks: [cacheHit.track] };
    }
    return this.getTrackData(query, guildId, context);
  },

  /**
   * 트랙의 공유 캐시 키(audioSourceKey) 산출 — yt/sc/direct는 즉시,
   * spotify는 YouTube 동등물이 정해진 뒤에만 가능(findYouTubeEquivalent가 설정).
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
    } else if (track.platform === "spotify" && track.youtubeUrl) {
      const vid = YouTube.extractVideoId(track.youtubeUrl);
      if (vid) track.audioSourceKey = `yt:${vid}`;
    }
    return track.audioSourceKey || null;
  },

  /**
   * Spotify/SoundCloud 트랙의 YouTube 동등물 검색.
   * 성공 시 track.youtubeUrl(및 가능하면 audioSourceKey)을 설정하고 URL 반환, 실패 시 null.
   */
  async findYouTubeEquivalent(track, guildId) {
    if (track.youtubeUrl) {
      this.ensureAudioSourceKey(track);
      return track.youtubeUrl;
    }

    const queries = track.platform === "spotify" ? [`"${track.title}" "${track.artist}"`, `${track.title} ${track.artist}`, `${track.title}`] : [`${track.title}`];

    for (const query of queries) {
      try {
        const results = await YouTube.search(query, 3, guildId);
        if (results && results.length > 0) {
          const titleLower = (track.title || "").toLowerCase();
          const picked = results.find((r) => r.title.toLowerCase().includes("official") || r.title.toLowerCase().includes(titleLower)) || results[0];
          if (picked && picked.url) {
            track.youtubeUrl = picked.url;
            track.youtubeTitle = picked.title;
            this.ensureAudioSourceKey(track);
            return track.youtubeUrl;
          }
        }
      } catch (e) {
        /* 다음 쿼리로 계속 */
      }
    }
    return null;
  },

  /**
   * 재생용 스트림 획득 — 플랫폼 스위치 단일화.
   * spotify는 YouTube 동등물을 먼저 확보(track.youtubeUrl 재사용)한 뒤 YouTube로 위임.
   */
  async getStream(track, guildId, seekSeconds = 0) {
    switch (track.platform) {
      case "youtube":
        return YouTube.getStream(track.url, guildId, seekSeconds);

      case "spotify": {
        const ytUrl = await this.findYouTubeEquivalent(track, guildId);
        if (!ytUrl) throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${track.title}`);
        return YouTube.getStream(ytUrl, guildId, seekSeconds);
      }

      case "soundcloud":
        return SoundCloud.getStream(track.url, guildId, seekSeconds);

      case "direct":
        // URL 서술자만 반환 — 실제 fetch는 소비 시점에 DirectLink.getStream(SafeUrl 가드)이
        // 수행한다. 여기서 스트림을 미리 열면 프리로드가 연결을 열고 버리는 누수·이중소비가 생긴다.
        return { url: track.url, platform: "direct", httpHeaders: {} };

      default:
        throw new Error(`지원되지 않는 플랫폼: ${track.platform}`);
    }
  },
};

module.exports = TrackResolver;
