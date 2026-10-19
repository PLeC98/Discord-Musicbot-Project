// 판정: 이 링크는 누가 다루나. 보는 것은 주소 문자열뿐이다.
// 답: youtube · spotify · soundcloud · direct · search · unknown.
//   direct   알려진 사이트 밖의 http(s) 주소. 음원인지는 열어 본 응답으로 판정한다(sources/direct-open)
//   search   링크가 아닌 글(검색어)
//   unknown  알려진 사이트의 주소인데 우리가 다루지 않는 모양. 거절한다(주소 문자열을 검색어로 쓰면 엉뚱한 곡이 나온다)
// ytdlp(아무 yt-dlp 주소)는 이름만 정해 두었다. 열면 그 호스트 목록이 direct 앞에 선다.

import { isYouTubeURL, isSpotifyURL, isSoundCloudURL, isKnownSiteHost, isHttpLink } from "./links.ts";
// 순서가 답을 바꾼다. 사이트의 모양을 먼저 보고, 그 사이트의 다른 주소를 걸러 낸 뒤 나머지가 직접 링크다
// (soundcloud.com/…/x.mp3 는 사운드클라우드다).
type InputKind = "youtube" | "spotify" | "soundcloud" | "direct" | "unknown" | "search";

function inputKind(value: unknown): InputKind {
  if (isYouTubeURL(value)) return "youtube";
  if (isSpotifyURL(value)) return "spotify";
  if (isSoundCloudURL(value)) return "soundcloud";
  if (isKnownSiteHost(value)) return "unknown";
  return isHttpLink(value) ? "direct" : "search";
}

export { inputKind };
export type { InputKind };
