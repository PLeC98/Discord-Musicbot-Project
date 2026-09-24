// 판정: 이 링크는 누가 다루나. 보는 것은 주소 글자뿐이다.
// 답: youtube · spotify · soundcloud · direct · search · unknown.
//   search   링크가 아닌 글(검색어)
//   unknown  http(s) 주소인데 우리가 다루지 않는 것. 거절한다(주소 글자를 검색어로 쓰면 엉뚱한 곡이 나온다)
// ytdlp(아무 yt-dlp 주소)는 이름만 정해 두었다. 받는 것은 새 기능이라 아직 unknown 으로 떨어진다.

import links from "./links.ts";
const { isYouTubeURL, isSpotifyURL, isSoundCloudURL, isDirectAudioLink, isHttpLink } = links;

// 차례가 답을 바꾼다. 사이트 호스트를 먼저 보고, 확장자로 가리는 직접 링크는 마지막이다
// (soundcloud.com/…/x.mp3 는 사운드클라우드다).
type InputKind = "youtube" | "spotify" | "soundcloud" | "direct" | "unknown" | "search";

function inputKind(value: unknown): InputKind {
  if (isYouTubeURL(value)) return "youtube";
  if (isSpotifyURL(value)) return "spotify";
  if (isSoundCloudURL(value)) return "soundcloud";
  if (isDirectAudioLink(value)) return "direct";
  return isHttpLink(value) ? "unknown" : "search";
}

const exported = { inputKind };
export default exported;
export { exported as "module.exports" };
