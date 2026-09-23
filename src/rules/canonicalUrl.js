"use strict";

// 판정: 이 링크를 어떤 모양으로 적나. 링크 장부의 열쇠가 된다.
// 지금은 유튜브만 다듬는다(영상 id 로 모은다). 다른 사이트 규칙은 따로 정한다.

const { extractVideoId } = require("./links");

function canonicalUrl(value) {
  if (typeof value !== "string") return value;
  const videoId = extractVideoId(value);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : value;
}

module.exports = { canonicalUrl };
