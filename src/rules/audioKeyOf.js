"use strict";

// 판정: 이 소리의 캐시 열쇠는. 보는 것은 음원 주소 하나뿐이다. 모르면 null.
//   유튜브        yt:<영상 id>
//   사운드클라우드 sc:<다듬은 경로>(soundcloud.com/ 뒤. 다른 호스트면 호스트부터)
//   직접 링크     dl:<주소의 md5>. 서명된 주소는 쿼리까지 다른 파일이다
// 출처가 달라도 음원 주소가 같으면 파일 하나를 함께 쓴다. 열쇠는 저장하지 않고 쓸 때마다 이것으로 계산한다.

const crypto = require("crypto");
const { extractVideoId, isDirectAudioLink } = require("./links");
const { inputKind } = require("./inputKind");
const { canonicalUrl } = require("./canonicalUrl");

const md5 = (value) => crypto.createHash("md5").update(String(value)).digest("hex");

function audioKeyOf(audioUrl) {
  switch (inputKind(audioUrl)) {
    case "youtube": {
      const vid = extractVideoId(audioUrl);
      return vid ? `yt:${vid}` : null;
    }
    case "soundcloud":
      return `sc:${canonicalUrl(audioUrl).replace(/^https:\/\/(soundcloud\.com\/)?/, "")}`;
    case "direct":
      return `dl:${md5(audioUrl)}`;
    default:
      return null;
  }
}

// 옛 칸(url · youtubeUrl · platform)에서 음원 주소를 고른다. 트랙이 audioUrl 을 다 들게 되면 걷는다.
// 찾아 둔 영상이 있으면 그것, 아니면 곡 주소가 곧 음원인 곡(유튜브 · 사운드클라우드 · 직접 링크)의 주소
function audioUrlOf(track) {
  if (track.audioUrl) return track.audioUrl;
  if (track.platform === "soundcloud") return track.url; // 영상이 붙어 있어도 제 음원을 쓴다
  if (track.youtubeUrl) return track.youtubeUrl;
  if (track.platform === "youtube" && !track.url && track.id) return `https://www.youtube.com/watch?v=${track.id}`;
  if (["youtube", "soundcloud", "direct"].includes(track.platform)) return track.url;
  return isDirectAudioLink(track.url) ? track.url : null;
}

module.exports = { audioKeyOf, audioUrlOf, md5 };
