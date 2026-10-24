// 판정: 이 링크를 어떤 모양으로 적나. 오디오 링크 데이터의 키가 된다. 같은 곡을 가리키는 공유 링크 여럿이 한 모양으로 모인다.
//
//   유튜브        영상 id 로 모은다(list= · index= · si= · t= · 호스트 차이를 버린다). 재생목록 주소는 그대로
//   스포티파이    종류와 id 로 모은다(지역 경로 intl-xx/ · si= 같은 쿼리 · spotify: URI 모양을 버린다)
//   사운드클라우드 경로만 남긴다(si= · utm_* · in= 같은 쿼리와 www. · m. 호스트를 버린다)
//   직접 링크     그대로. 서명된 주소는 쿼리에 토큰이 있어 버리면 다운로드하지 못한다
//   그 밖         다듬지 않는다

import { extractVideoId, parseSpotifyURL, youtubeWatchUrl } from "./links.ts";
import { inputKind } from "./input-kind.ts";
function soundCloudPath(value: string): string {
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  return `https://${host}${url.pathname.replace(/\/+$/, "")}`;
}

function canonicalUrl(value: string): string;
function canonicalUrl<T>(value: T): T;
function canonicalUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  switch (inputKind(value)) {
    case "youtube": {
      const videoId = extractVideoId(value);
      return videoId ? youtubeWatchUrl(videoId) : value;
    }
    case "spotify": {
      const { type, id } = parseSpotifyURL(value);
      return type && id ? `https://open.spotify.com/${type}/${id}` : value;
    }
    case "soundcloud":
      return soundCloudPath(value);
    default:
      return value;
  }
}

export { canonicalUrl };
