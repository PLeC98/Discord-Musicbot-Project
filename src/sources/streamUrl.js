"use strict";

// 트랙 → 지금 쓸 스트림 서술자. 플랫폼마다 누가 여는지만 가른다.

const YouTube = require("./youtube/index");
const links = require("../rules/links");
const log = require("../infra/log/logger").child({ category: "track" });
const SoundCloud = require("./soundcloud");
const equivalent = require("./youtube/equivalent");

const streamUrl = {
  /**
   * 재생용 스트림 획득. 플랫폼 스위치 단일화.
   * spotify는 YouTube 동등물을 먼저 확보(track.youtubeUrl 재사용)한 뒤 YouTube로 위임.
   */
  // youtube: 유튜브 스트림을 여는 쪽. 생략하면 진짜
  async getStream(track, seekSeconds = 0, { youtube = YouTube } = {}) {
    switch (track.platform) {
      case "youtube":
        return youtube.getStream(track.url, seekSeconds);

      case "spotify": {
        let ytUrl = await equivalent.findYouTubeEquivalent(track);
        if (!ytUrl) throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${track.title}`);
        try {
          return await youtube.getStream(ytUrl, seekSeconds);
        } catch (err) {
          // 캐시 매핑의 영상이 내려간 경우(프리로드·즉시재생 스트리밍이 여기서 먼저 실패) → 재검색 후 1회 재시도.
          if (youtube.isVideoUnavailableError(err) && track._youtubeFromCache) {
            log.warn({ tags: ["retry"] }, `캐시된 유튜브 영상 접근 불가 (${track.title}). 재검색 후 재시도`);
            ytUrl = await equivalent.reresolveYouTube(track);
            if (ytUrl) return await youtube.getStream(ytUrl, seekSeconds);
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
        if (track.youtubeUrl) return youtube.getStream(track.youtubeUrl, seekSeconds);
        // AnimeThemes처럼 출처 이름을 platform 에 쓰면서 음원을 직접 받는 곡.
        // 위의 "direct"와 같은 처지이므로 같은 서술자를 돌려준다.
        if (links.isDirectAudioLink(track.url)) return { url: track.url, platform: "direct", httpHeaders: {} };
        throw new Error(`지원되지 않는 플랫폼: ${track.platform}`);
    }
  },
};

module.exports = streamUrl;
