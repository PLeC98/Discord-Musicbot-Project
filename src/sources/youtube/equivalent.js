"use strict";

// 스포티파이 · 사운드클라우드 곡의 유튜브 동등물 찾기. 찾은 영상 주소와 캐시 열쇠를 트랙에 적는다.

const YouTube = require("./index");
const trackLookup = require("../../store/trackLookup");
const lookup = require("../lookup");
const { buildSearchQueries, mergeCandidateLists, rankCandidates } = require("./match");

const equivalent = {
  /**
   * Spotify/SoundCloud 트랙의 YouTube 동등물 검색. 점수제 선택(src/sources/youtube/match.js).
   * 유튜브 순위 + 스포티파이 길이 일치를 지배 신호로, 채널일치·정크를 타이브레이커로 삼아
   * 원곡/커버/리믹스/TV size 등을 올바로 구분한다. 성공 시 track.youtubeUrl(및 audioSourceKey)을
   * 설정하고 URL 반환, 실패 시 null.
   */
  // search: 유튜브 검색 함수. 생략하면 진짜
  async findYouTubeEquivalent(track, { search = (query, limit) => YouTube.search(query, limit) } = {}) {
    if (track.youtubeUrl) {
      lookup.ensureAudioSourceKey(track);
      return track.youtubeUrl;
    }

    // Tier-1: 이미 해결된 매핑이 있으면 유튜브 검색을 건너뛴다(파일 존재 여부 무관).
    // 매핑의 영상이 내려간 경우는 소비(다운로드) 시점에서 감지해 reresolveYouTube로 재검색한다.
    if (track.url) {
      const cachedKey = trackLookup.getResolvedKey(track.url);
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
          const results = await search(query, 6);
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
    lookup.ensureAudioSourceKey(track);
    return track.youtubeUrl;
  },

  /**
   * 캐시 매핑의 유튜브 영상이 내려간 경우: 스테일 매핑을 삭제하고 새로 검색한다.
   * 재검색 결과는 _youtubeFromCache가 아니므로(신규 검색), 다시 실패해도 이 경로가 재발동하지 않는다(무한루프 방지).
   */
  async reresolveYouTube(track, deps) {
    if (track.url) trackLookup.removeResolution(track.url);
    track.youtubeUrl = null;
    track.youtubeTitle = null;
    track.audioSourceKey = null;
    track._youtubeFromCache = false;
    return this.findYouTubeEquivalent(track, deps);
  },
};

module.exports = equivalent;
