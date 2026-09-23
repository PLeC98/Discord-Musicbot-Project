"use strict";

// 트랙 → 지금 쓸 스트림 서술자. 음원 주소가 어느 사이트인지만 보고 누가 여는지 가른다.

const YouTube = require("./youtube/index");
const { inputKind } = require("../rules/inputKind");
const log = require("../infra/log/logger").child({ category: "track" });
const SoundCloud = require("./soundcloud");
const equivalent = require("./youtube/equivalent");

const streamUrl = {
  /**
   * 재생용 스트림 획득. 음원 주소가 없는 곡(스포티파이)은 유튜브 동등물을 먼저 찾는다.
   * 곡이 어디서 왔는지(platform)는 보지 않는다. 자동재생 곡은 출처 이름을 들고 소리는 영상이나 음원에서 온다.
   */
  // youtube: 유튜브 스트림을 여는 쪽. 생략하면 진짜
  async getStream(track, seekSeconds = 0, { youtube = YouTube } = {}) {
    if (!track.audioUrl && !(await equivalent.findYouTubeEquivalent(track))) {
      throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${track.title}`);
    }

    switch (inputKind(track.audioUrl)) {
      case "youtube":
        try {
          return await youtube.getStream(track.audioUrl, seekSeconds);
        } catch (err) {
          // 장부에서 가져온 영상이 내려간 경우(프리로드·즉시재생 스트리밍이 여기서 먼저 실패) → 재검색 후 1회 재시도.
          if (youtube.isVideoUnavailableError(err) && track.audioFoundBy === "ledger") {
            log.warn({ tags: ["retry"] }, `캐시된 유튜브 영상 접근 불가 (${track.title}). 재검색 후 재시도`);
            const ytUrl = await equivalent.reresolveYouTube(track);
            if (ytUrl) return await youtube.getStream(ytUrl, seekSeconds);
          }
          throw err;
        }

      case "soundcloud":
        return SoundCloud.getStream(track.audioUrl);

      case "direct":
        // URL 서술자만 반환. 실제 fetch는 소비 시점에 DirectLink.getStream(SafeUrl 가드)이
        // 수행한다. 여기서 스트림을 미리 열면 프리로드가 연결을 열고 버리는 누수·이중소비가 생긴다.
        return { url: track.audioUrl, platform: "direct", httpHeaders: {} };

      default:
        throw new Error(`지원되지 않는 음원 주소: ${track.platform}`);
    }
  },
};

module.exports = streamUrl;
