// 판정: 자동재생 출처(재생목록)의 주소를 어떤 모양으로 저장하나. 목록을 가리키는 부분만 남긴다.
//
//   스포티파이  종류와 id 만(si= 같은 공유 추적 쿼리 · 지역 경로 intl-xx/ · spotify: URI 모양을 버린다)
//   유튜브      재생목록 id 만(pp= · start_radio= · si= · 영상 v= · index= 를 버린다). 호스트는 www.youtube.com 으로
//   그 밖       다듬지 않는다. 모양을 모르는 주소는 그대로 두고 검사 · 실행이 판단한다
//
// canonicalUrl 과 다르다. 그쪽은 곡을 모으므로 유튜브 주소를 영상 하나로 줄인다(재생목록이 사라진다).

import { extractPlaylistId, isYouTubeHost, parseSpotifyURL } from "./links.ts";

function sourceUrl(type: string, url: string): string {
  const value = url.trim();
  if (type === "spotify") {
    const { type: kind, id } = parseSpotifyURL(value);
    return kind && id ? `https://open.spotify.com/${kind}/${id}` : url;
  }
  if (type === "youtube" && isYouTubeHost(value)) {
    const list = extractPlaylistId(value);
    return list ? `https://www.youtube.com/playlist?list=${list}` : url;
  }
  return url;
}

export { sourceUrl };
