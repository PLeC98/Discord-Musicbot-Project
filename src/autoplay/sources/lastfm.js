"use strict";

// Last.fm 소스.

const config = require("../../../config");
const { pick, rand, query, getJson } = require("./http");

// ── lastfm ────────────────────────────────────────────────────────────────
// 길이를 안 준다(정 유형). 깊은 쪽이 오히려 알차므로 무작위 쪽을 퍼 올린다.
async function lastfm(source) {
  const key = config.sources?.lastfmKey;
  if (!key) throw new Error("LASTFM_API_KEY가 없습니다");
  const tag = pick(source.tags || []);
  if (!tag) return [];

  const page = 1 + rand(Math.max(1, Number(source.pages) || 5));
  const url = `https://ws.audioscrobbler.com/2.0/?${query({ method: "tag.getTopTracks", tag, limit: 1000, page, api_key: key, format: "json" })}`;
  const list = (await getJson(url))?.tracks?.track || [];
  return list
    .map((t) => ({
      artist: t.artist?.name || "",
      title: t.name || "",
      sourceUrl: t.url || undefined, // Last.fm 곡 페이지가 곧 출처 주소다
      platform: "lastfm",
      sourceKey: t.url || `${t.artist?.name}|${t.name}`,
    }))
    .filter((t) => t.artist && t.title);
}

module.exports = { lastfm };
