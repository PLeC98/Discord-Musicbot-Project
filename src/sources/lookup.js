// 곡 찾기. 링크나 검색어 → 트랙 정보(메타데이터). 여러 곡 출처는 구간만 받는다.

import YouTube from "./youtube/index.js";
import links from "../rules/links.ts";
import Spotify from "./spotify.js";
import SoundCloud from "./soundcloud.js";
import DirectLink from "./direct.js";
import trackLookup from "../store/trackLookup.js";
import errorKindModule from "../rules/errorKind.ts";
const { errorKind } = errorKindModule;
import inputKindModule from "../rules/inputKind.ts";
const { inputKind } = inputKindModule;
import logger from "../infra/log/logger.js";
const log = logger.child({ category: "track" });

const lookup = {
  // 쿼리 문자열이 어느 쪽으로 가나. 링크가 아닌 글은 유튜브에서 찾는다. 모르는 링크는 unknown(거절)
  detectPlatform(query) {
    const kind = inputKind(query);
    return kind === "search" ? "youtube" : kind;
  },

  /**
   * 우리가 다루지 않는 링크인가(유튜브 클립 · 채널 · 검색 결과 페이지, 모르는 사이트).
   *
   * 이런 주소를 검색으로 흘리면 URL 문자열 자체가 검색어가 되어 엉뚱한 영상이 재생되기에 재생을 거절한다.
   * (클립은 2026년 유튜브가 기능을 없앴다. 지원 대상이 아니다.)
   */
  isUnsupportedLink(query) {
    return inputKind(query) === "unknown";
  },

  // 쿼리 → { success, isPlaylist, collection, tracks, total, nextOffset } 또는 { success: false, code, error? }
  //   code: no-result(찾은 것이 없다) · lookup-failed(error: 조회가 던진 오류). 문장은 부르는 쪽이 ui/errorMessages 로 만든다
  // collection: 여러 곡을 담은 출처의 종류. "playlist" | "album" | "artist", 한 곡이면 null
  // range: 여러 곡 출처에서 받을 구간 { offset, limit }. 한 곡이면 무시. total은 모르면 null.
  async getTrackData(query, context = "lookup.getTrackData", { offset = 0, limit } = {}) {
    try {
      let tracks = [];
      let isPlaylist = false;
      let collection = null;
      let total = null;
      let nextOffset = null;

      switch (this.detectPlatform(query)) {
        case "unknown":
          return { success: false, message: links.isYouTubeHost(query) ? "❌ 재생할 수 없는 유튜브 주소입니다." : "❌ 지원하지 않는 링크입니다." };

        case "youtube":
          if (links.isYouTubePlaylist(query)) {
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
          } else {
            tracks = await YouTube.search(query, 1);
          }
          break;

        case "spotify":
          if (links.isSpotifyURL(query)) {
            const part = await Spotify.getCollection(query, { offset, limit });
            tracks = part.tracks || [];
            const { type } = links.parseSpotifyURL(query);
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
        return { success: false, code: "no-result" };
      }

      return { success: true, isPlaylist, collection, tracks, total, nextOffset };
    } catch (error) {
      log.error({ sub: context || undefined, kind: errorKind(error) }, `${error?.message || error}`);
      return { success: false, code: "lookup-failed", error };
    }
  },

  // 여러 곡 출처의 구간만. 이어 넣기용. getTrackData와 달리 못 받으면 검색으로 넘어가지 않는다
  // (유튜브는 목록 끝을 넘는 구간이면 항목이 비어 getPlaylist가 null이다).
  async getCollection(url, range) {
    const none = { tracks: [], total: null, nextOffset: null };
    if (links.isYouTubePlaylist(url)) {
      const r = await YouTube.getPlaylist(url, range);
      return r ? { tracks: r.tracks, total: r.total ?? null, nextOffset: r.nextOffset ?? null } : none;
    }
    if (links.isSpotifyURL(url)) return Spotify.getCollection(url, range);
    return none;
  },

  /**
   * 캐시 숏컷 포함 해석. 캐시된 단일 곡은 yt-dlp 호출 없이 즉시 반환.
   * 재생목록 URL은 캐시를 우회: URL 정규화가 list=를 제거하므로 캐시된 단일 영상이 재생목록 전체를 가릴 수 있음.
   * 지원하지 않는 링크(모르는 사이트 · 유튜브 클립 등)도 우회한다. 예전에 검색으로 흘러 잘못 맺힌 매핑이 남아 있으면
   * 캐시가 그 엉뚱한 영상을 그대로 돌려준다.
   */
  async resolveQuery(query, context, range = {}) {
    const skipCache = links.isYouTubePlaylist(query) || this.isUnsupportedLink(query);
    const cacheHit = skipCache ? { hit: false } : trackLookup.resolveFromCache(query);
    if (cacheHit.hit) {
      log.debug(`캐시 히트(조회 · 검색 생략): "${cacheHit.track.title}" → ${cacheHit.track.audioUrl}`);
      return { success: true, isPlaylist: false, tracks: [cacheHit.track] };
    }
    return this.getTrackData(query, context, range);
  },
};

export default lookup;
export { lookup as "module.exports" };
