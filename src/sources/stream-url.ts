// 트랙 → 지금 쓸 스트림 서술자. 음원 주소가 어느 사이트인지만 보고 누가 여는지 구분한다.

import { codedError } from "../rules/error-kind.ts";
import * as YouTube from "./youtube/index.ts";
import { inputKind } from "../rules/input-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });
import * as SoundCloud from "./soundcloud/index.ts";
import * as DirectLink from "./direct.ts";
import * as equivalentModule from "./youtube/equivalent.ts";
import type { Seeking } from "./youtube/equivalent.ts";
import { logTitle } from "../infra/log/title.ts";
import { leaveDeadPin } from "./pinned-fallback.ts";

// 여는 쪽 · 동등물 찾는 쪽. 테스트가 가짜를 넘긴다
/** 스트림 서술자. 재생 쪽이 읽는 필드만 적는다. 소스마다 필드가 더 있다 */
type StreamInfo = {
  url: string;
  protocol?: string | null;
  platform?: string;
  httpHeaders?: Record<string, string>;
  /** 영상 자체의 제목(유튜브). 모르면 null */
  title?: string | null;
  duration?: number;
  liveStatus?: string | null;
  bitrate?: number;
  isLive?: boolean;
  /** 이 시각(유닉스 초) 전에는 본편 요청이 막힐 수 있다. 앞 광고가 끝나는 때(yt-dlp 의 available_at) */
  availableAt?: number | null;
  /** 조각 목록으로만 주는 포맷이면 조각 주소의 모양(포맷 주소 뒤 `&sq=번호`, 조각 수). 아니면 없다 */
  fragments?: { base: string; count: number } | null;
  [field: string]: unknown;
};
// 여기서 부르는 것만
type YouTubeStreams = { getStream(url: string): Promise<StreamInfo>; isVideoUnavailableError(error: unknown): boolean };
type SoundCloudStreams = { getStream(url: string, options?: { canPlayHls?: boolean }): Promise<StreamInfo> };
type DirectInfo = { getInfo(url: string): Promise<Array<{ isLive?: boolean }>> };
type Equivalent = { findYouTubeEquivalent(track: Seeking, opts?: { skipPin?: boolean }): Promise<string | null>; reresolveYouTube(track: Seeking): Promise<string | null> };
/** canPlayHls: ffmpeg 가 HLS 를 여는가(재생 쪽이 안다) */
type StreamOptions = { youtube: YouTubeStreams; soundcloud: SoundCloudStreams; direct: DirectInfo; equivalent: Equivalent; canPlayHls: boolean };
const DEFAULTS: StreamOptions = { youtube: YouTube, soundcloud: SoundCloud, direct: DirectLink, equivalent: equivalentModule, canPlayHls: true };

/**
 * 재생용 스트림 획득. 음원 주소가 없는 곡(스포티파이)은 유튜브 동등물을 먼저 찾는다.
 * 곡이 어디서 왔는지(platform)는 보지 않는다. 자동재생 곡은 출처 이름을 들고 소리는 영상이나 음원에서 온다.
 */
// options: 넘기지 않은 것은 진짜(youtube · soundcloud · equivalent)와 canPlayHls = true
async function getStream(track: Seeking & { platform?: string | null }, options: Partial<StreamOptions> = {}) {
  const opts = { ...DEFAULTS, ...options };
  try {
    const stream = await streamOf(track, opts);
    // 라이브는 지정할 수 없다: 지정한 음원이 라이브면 사라진 것과 같이 다룬다(나중에 라이브가 되는 예약 방송도 있어 지정할 때가 아니라 틀 때 본다)
    if (track.audioFoundBy === "pinned" && (await pinnedLive(track.audioUrl, stream, opts.direct))) throw codedError("pinned-live", `직접 지정한 음원이 라이브입니다: ${track.audioUrl}`);
    return stream;
  } catch (error) {
    // 직접 지정한 음원이 사라졌으면 이번 재생은 지정을 건너뛰고 다시 찾아 한 번 더(sources/pinned-fallback)
    if (await leaveDeadPin(track, error, opts.equivalent)) return await streamOf(track, opts);
    throw error;
  }
}

/** 지정한 음원이 라이브인가: 유튜브는 스트림 답(방송 중 · 시작 전), 직접 링크는 인터넷 라디오 헤더(HEAD) */
async function pinnedLive(audioUrl: string | null | undefined, stream: StreamInfo, direct: DirectInfo): Promise<boolean> {
  if (stream.liveStatus === "is_live" || stream.liveStatus === "is_upcoming") return true;
  if (!audioUrl || inputKind(audioUrl) !== "direct") return false;
  const [info] = await direct.getInfo(audioUrl);
  return info?.isLive === true;
}

async function streamOf(track: Seeking & { platform?: string | null }, { youtube, soundcloud, equivalent, canPlayHls }: StreamOptions) {
  const audioUrl = track.audioUrl || (await equivalent.findYouTubeEquivalent(track));
  if (!audioUrl) {
    throw codedError("sp-no-youtube-match", `Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${logTitle(track.title)}`);
  }

  switch (inputKind(audioUrl)) {
    case "youtube":
      try {
        return await youtube.getStream(audioUrl);
      } catch (err) {
        // 링크 데이터에서 가져온 영상이 내려간 경우(프리로드·즉시재생 스트리밍이 여기서 먼저 실패) → 재검색 후 1회 재시도.
        if (youtube.isVideoUnavailableError(err) && track.audioFoundBy === "ledger") {
          log.warn({ tags: ["retry"] }, `캐시된 유튜브 영상 접근 불가 (${logTitle(track.title)}). 재검색 후 재시도`);
          const ytUrl = await equivalent.reresolveYouTube(track);
          if (ytUrl) return await youtube.getStream(ytUrl);
        }
        throw err;
      }

    case "soundcloud":
      return soundcloud.getStream(audioUrl, { canPlayHls });

    case "direct":
      // URL 서술자만 반환. 실제 fetch는 소비 시점에 DirectLink.getStream(SafeUrl 가드)이
      // 수행한다. 여기서 스트림을 미리 열면 프리로드가 연결을 열고 버리는 누수·이중소비가 생긴다.
      // 인터넷 라디오는 담을 때 라이브로 적었다(sources/direct). 재생도 라이브로 연다
      return { url: audioUrl, platform: "direct", httpHeaders: {}, liveStatus: track.isLive === true ? "is_live" : null };

    default:
      throw new Error(`지원되지 않는 음원 주소: ${track.platform}`);
  }
}

export { getStream };
export type { StreamInfo, StreamOptions };
