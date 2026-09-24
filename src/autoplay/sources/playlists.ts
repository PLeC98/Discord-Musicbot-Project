// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 재생목록 소스(스포티파이 · 유튜브).

import http from "./http.ts";
const { rand } = http;
import * as Spotify from "../../sources/spotify.ts";
import * as YouTube from "../../sources/youtube/index.ts";

// ── 재생목록 ──────────────────────────────────────────────────────────────
// 통째로 받지 않는다. total을 알면 무작위 오프셋으로 한 구간만 집어 온다.
const PLAYLIST_PAGE = 50;

async function spotify(source) {
  if (!source.url) return [];
  const head = await Spotify.getCollection(source.url, { offset: 0, limit: 1 });
  const total = Number(head?.total) || 0;
  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await Spotify.getCollection(source.url, { offset, limit: PLAYLIST_PAGE });
  return (part?.tracks || []).filter((t) => t.title && t.artist).map((t) => ({ artist: t.artist, title: t.title, durationSec: Number(t.duration) || undefined, thumbnail: t.thumbnail, sourceUrl: t.pageUrl || undefined, platform: "spotify", sourceKey: t.requestKey || `${t.artist}|${t.title}` }));
}

async function youtube(source) {
  if (!source.url) return [];
  const head = await YouTube.getPlaylist(source.url, { offset: 0, limit: 1 });
  // 믹스(RD…)는 total이 null이다. 끝이 없어 무작위 오프셋을 쓸 수 없다
  const total = Number(head?.total) || 0;
  if (!total) throw new Error("재생목록의 곡 수를 알 수 없습니다(유튜브 믹스는 소스로 쓸 수 없습니다)");

  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await YouTube.getPlaylist(source.url, { offset, limit: PLAYLIST_PAGE });
  // 재생목록은 아티스트가 안 온다(제목뿐). 그래서 youtubeMatch를 거치지 않고 주소를 그대로 쓴다
  return (part?.tracks || []).filter((t) => t.audioUrl && !t.isLive).map((t) => ({ title: t.title, durationSec: Number(t.duration) || undefined, youtubeUrl: t.audioUrl, thumbnail: t.thumbnail, sourceKey: t.requestKey }));
}

const exported = { spotify, youtube };
export default exported;
export { exported as "module.exports" };
