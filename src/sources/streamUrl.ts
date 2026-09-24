// 트랙 → 지금 쓸 스트림 서술자. 음원 주소가 어느 사이트인지만 보고 누가 여는지 가른다.

import * as YouTube from "./youtube/index.ts";
import { inputKind } from "../rules/inputKind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });
import * as SoundCloud from "./soundcloud.ts";
import * as equivalentModule from "./youtube/equivalent.ts";
import type { Seeking } from "./youtube/equivalent.ts";

// 여는 쪽 · 동등물 찾는 쪽. 테스트가 가짜를 넘긴다
type YouTubeStreams = Pick<typeof YouTube, "getStream" | "isVideoUnavailableError">;
type SoundCloudStreams = Pick<typeof SoundCloud, "getStream">;
type Equivalent = Pick<typeof equivalentModule, "findYouTubeEquivalent" | "reresolveYouTube">;
/** canPlayHls: ffmpeg 가 HLS 를 여는가(재생 쪽이 안다) */
type StreamOptions = { youtube: YouTubeStreams; soundcloud: SoundCloudStreams; equivalent: Equivalent; canPlayHls: boolean };
const DEFAULTS: StreamOptions = { youtube: YouTube, soundcloud: SoundCloud, equivalent: equivalentModule, canPlayHls: true };

/**
 * 재생용 스트림 획득. 음원 주소가 없는 곡(스포티파이)은 유튜브 동등물을 먼저 찾는다.
 * 곡이 어디서 왔는지(platform)는 보지 않는다. 자동재생 곡은 출처 이름을 들고 소리는 영상이나 음원에서 온다.
 */
// options: 넘기지 않은 것은 진짜(youtube · soundcloud · equivalent)와 canPlayHls = true
async function getStream(track: Seeking & { platform?: string | null }, seekSeconds = 0, options: Partial<StreamOptions> = {}) {
  const { youtube, soundcloud, equivalent, canPlayHls } = { ...DEFAULTS, ...options };
  const audioUrl = track.audioUrl || (await equivalent.findYouTubeEquivalent(track));
  if (!audioUrl) {
    throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${track.title}`);
  }

  switch (inputKind(audioUrl)) {
    case "youtube":
      try {
        return await youtube.getStream(audioUrl, seekSeconds);
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
      return soundcloud.getStream(audioUrl, { canPlayHls });

    case "direct":
      // URL 서술자만 반환. 실제 fetch는 소비 시점에 DirectLink.getStream(SafeUrl 가드)이
      // 수행한다. 여기서 스트림을 미리 열면 프리로드가 연결을 열고 버리는 누수·이중소비가 생긴다.
      return { url: audioUrl, platform: "direct", httpHeaders: {} };

    default:
      throw new Error(`지원되지 않는 음원 주소: ${track.platform}`);
  }
}

export { getStream };
