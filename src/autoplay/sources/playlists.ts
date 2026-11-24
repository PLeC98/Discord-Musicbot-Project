// 재생목록 소스(스포티파이, 유튜브).

import { rand } from "./http.ts";
import * as spotifySource from "../../sources/spotify.ts";
import * as youtubeSource from "../../sources/youtube/index.ts";
import type { GenreSource } from "../../config/genres.ts";
import type { Candidate } from "./candidate.ts";
import { L } from "../../infra/log/text.ts";
import { logTextError } from "../../infra/log/log-text.ts";

// 통째로 불러오지 않는다. total을 알면 무작위 오프셋으로 한 구간만 집어 온다.
const PLAYLIST_PAGE = 50;

async function spotify(source: GenreSource): Promise<Candidate[]> {
  if (!source.url) return [];
  const head = await spotifySource.getCollection(source.url, { offset: 0, limit: 1 });
  const total = Number(head?.total) || 0;
  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await spotifySource.getCollection(source.url, { offset, limit: PLAYLIST_PAGE });
  return (part?.tracks || []).flatMap((t) => (t.title && t.artist ? [{ ...t, title: t.title, artist: t.artist }] : [])).map((t) => ({ artist: t.artist, title: t.title, durationSec: Number(t.duration) || undefined, thumbnail: t.thumbnail, sourceUrl: t.pageUrl || undefined, platform: "spotify", sourceKey: t.requestKey || `${t.artist}|${t.title}` }));
}

async function youtube(source: GenreSource): Promise<Candidate[]> {
  if (!source.url) return [];
  // 목록을 불러오지 못하면 그 원인(없는, 비공개 목록, 네트워크)를 단 채로 예외를 던진다
  const head = await youtubeSource.getPlaylist(source.url, { offset: 0, limit: 1 });
  if (!head) throw logTextError(L.autoplay.playlistSourceEmpty());
  // 믹스(RD…)는 total이 null이다. 끝이 없어 무작위 오프셋을 쓸 수 없다
  const total = Number(head.total) || 0;
  if (!total) throw logTextError(L.autoplay.playlistSourceNoTotal());

  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await youtubeSource.getPlaylist(source.url, { offset, limit: PLAYLIST_PAGE });
  // 영상이 곧 곡이라 youtubeMatch를 거치지 않고 주소를 그대로 쓴다. 가수 자리는 올린 채널명(getPlaylist). 영상 주소가 곧 요청 키다
  return (part?.tracks || []).flatMap((t) => (t.audioUrl && t.title && !t.isLive ? [{ title: t.title, artist: t.artist || undefined, durationSec: Number(t.duration) || undefined, youtubeUrl: t.audioUrl, thumbnail: t.thumbnail, sourceKey: t.requestKey ?? t.audioUrl }] : []));
}

export { spotify, youtube };
