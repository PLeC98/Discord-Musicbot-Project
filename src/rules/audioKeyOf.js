"use strict";

// 판정: 이 소리의 캐시 열쇠는. yt:<영상 id> · sc:<id> · dl:<주소의 md5>. 모르면 null.
// 스포티파이와 자동재생이 출처에서 받아 온 곡은 소리가 유튜브에서 오므로 youtubeUrl 로 가린다.
// 출처가 달라도 같은 영상이면 음원 파일 하나를 함께 쓴다.

const crypto = require("crypto");
const { extractVideoId } = require("./links");

const md5 = (value) => crypto.createHash("md5").update(String(value)).digest("hex");

function audioKeyOf(track) {
  if (!track) return null;
  if (track.platform === "youtube") {
    const vid = track.id || extractVideoId(track.url);
    return vid ? `yt:${vid}` : null;
  }
  // id 가 없는 사운드클라우드 곡은 아래 갈래로 떨어진다(원래 규칙 그대로)
  if (track.platform === "soundcloud" && track.id) return `sc:${track.id}`;
  if (track.platform === "direct") return `dl:${md5(track.url)}`;
  if (track.youtubeUrl) {
    const vid = extractVideoId(track.youtubeUrl);
    return vid ? `yt:${vid}` : null;
  }
  return null;
}

module.exports = { audioKeyOf, md5 };
