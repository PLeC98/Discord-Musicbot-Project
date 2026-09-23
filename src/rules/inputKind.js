"use strict";

// 판정: 이 링크는 누가 다루나. 보는 것은 주소 글자뿐이다.
// 답: youtube · spotify · soundcloud · direct · unknown. 검색어도 unknown 이다.
// ytdlp(아무 yt-dlp 주소)는 이름만 정해 두었다. 받는 것은 새 기능이라 아직 unknown 으로 떨어진다.

const { isYouTubeURL, isSpotifyURL, isSoundCloudURL, isDirectAudioLink } = require("./links");

// 차례가 답을 바꾼다. 사이트 호스트를 먼저 보고, 확장자로 가리는 직접 링크는 마지막이다
// (soundcloud.com/…/x.mp3 는 사운드클라우드다).
function inputKind(value) {
  if (isYouTubeURL(value)) return "youtube";
  if (isSpotifyURL(value)) return "spotify";
  if (isSoundCloudURL(value)) return "soundcloud";
  if (isDirectAudioLink(value)) return "direct";
  return "unknown";
}

module.exports = { inputKind };
