// 곡 글자 검색: 유튜브와 스포티파이를 함께 찾아 섞는다. /search(자동완성, 결과 화면)와 대시보드 곡 추가 칸이 같이 쓴다.
// 몫, 마감, 섞는 규칙을 한곳에 둔다. 디스코드(discord.js)에 기대지 않는다

import * as YouTube from "../sources/youtube/index.ts";
import * as Spotify from "../sources/spotify.ts";
import type { SpotifyTrack } from "../sources/spotify.ts";
import type { TextSearchResult } from "../sources/youtube/text-search.ts";
import type { TrackInfo } from "../player/track.ts";
import { mixCounts, uniqueBy } from "../rules/search-mix.ts";
import { liveBlockReason } from "../rules/live-block-reason.ts";

/** 곡 후보 수(자동완성은 맨 위 줄을 따로 더한다), 결과 화면의 줄 수 */
const CHOICES = 10;
/** 그중 스포티파이 곡 몫(유튜브가 모자라면 더 채운다). 0 이면 섞지 않고, 유튜브가 연령 인증으로 막았을 때만 스포티파이로 채운다 */
const SPOTIFY_SHARE: number = 3;
/** 이보다 짧은 검색어(글자 수)는 찾지 않는다 */
const MIN_QUERY = 2;
/** 결과를 내는 쪽이 스포티파이를 기다리는 시간(ms). 넘기면 유튜브만 보인다(익명 상태를 처음 추출하면 수 초 걸린다) */
const SPOTIFY_RESULTS_MS = 4000;

/** 유튜브 검색, 스포티파이 검색과 그 준비, 시계, 기다리기. 생략하면 진짜(테스트가 가짜를 넘긴다) */
type SearchDeps = {
  search?: (query: string) => Promise<TextSearchResult>;
  searchSpotify?: (query: string) => Promise<SpotifyTrack[]>;
  spotifyReady?: () => boolean;
  now?: () => number;
  wait?: (ms: number) => Promise<unknown>;
};
/** 찾은 것. youtube 는 못 찾았으면 null */
type Found = { youtube: TextSearchResult | null; spotify: SpotifyTrack[] };
const NOTHING: Found = { youtube: null, spotify: [] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const depsOf = (deps: SearchDeps): Required<SearchDeps> => ({ search: YouTube.searchText, searchSpotify: Spotify.searchTracks, spotifyReady: Spotify.searchReady, now: Date.now, wait: sleep, ...deps });

// ms 안에 끝나면 그 결과. 넘기면 late, 던지면 failed(실패는 검색 모듈이 남겼다). 끝나지 않은 검색은 계속 돌아 기억을 채운다
function within<T>(work: Promise<T>, ms: number): Promise<{ value: T } | { missed: "late" | "failed" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ missed: "late" }>((resolve) => (timer = setTimeout(() => resolve({ missed: "late" }), ms)));
  const done = work.then(
    (value) => ({ value }),
    () => ({ missed: "failed" as const }),
  );
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}

/** 섞을 곡: 연령 인증으로 막힌 유튜브는 없는 것으로 */
const youtubeOf = (found: Found): TrackInfo[] => (found.youtube?.gated ? [] : (found.youtube?.tracks ?? []));

/** 찾은 곡 하나(유튜브 영상이나 스포티파이 곡) */
type Song = TrackInfo | SpotifyTrack;
/** 섞은 결과. gated: 유튜브가 연령 인증 안내만 주었고 스포티파이 곡도 없다 */
type SongResults = { songs: Song[]; gated: boolean };

// 예정 영상(최초 공개, 예정된 방송)은 넣으면 봇이 거절한다(live-upcoming). 봇의 판정을 그대로 쓴다
const upcoming = (track: Song) => "liveStatus" in track && liveBlockReason(track, { ffmpegReady: () => true }) === "live-upcoming";

/**
 * 대시보드 곡 추가 칸의 검색. 유튜브가 실패하면 던진다(부르는 쪽이 그 까닭을 알린다). 스포티파이는 준비돼 있을 때만, 마감 안에 온 것만 섞는다(늦거나 실패하면 유튜브만).
 * 예정 영상은 섞기 전에 빼서 자리를 다시 채운다. 같은 곡(출처, 제목, 가수, 길이가 같다)은 하나만
 */
async function findSongs(query: string, deps: SearchDeps = {}): Promise<SongResults> {
  const all = depsOf(deps);
  const spotifyWork = SPOTIFY_SHARE > 0 && all.spotifyReady() ? within(all.searchSpotify(query), SPOTIFY_RESULTS_MS) : null;
  const youtube = await all.search(query);
  const outcome = await (spotifyWork ?? (youtube.gated && all.spotifyReady() ? within(all.searchSpotify(query), SPOTIFY_RESULTS_MS) : null));
  const spotify = outcome && "value" in outcome ? outcome.value : [];
  const keyOf = (song: Song) => `${song.platform}\u0000${song.title ?? ""}\u0000${song.artist ?? ""}\u0000${song.duration}`;
  const fromYouTube = uniqueBy(
    youtubeOf({ youtube, spotify }).filter((track) => !upcoming(track)),
    keyOf,
  );
  const fromSpotify = uniqueBy(spotify, keyOf);
  const counts = mixCounts(fromYouTube.length, fromSpotify.length, { total: CHOICES, spotifyShare: SPOTIFY_SHARE });
  return { songs: [...fromYouTube.slice(0, counts.youtube), ...fromSpotify.slice(0, counts.spotify)], gated: youtube.gated && fromSpotify.length === 0 };
}

export { CHOICES, SPOTIFY_SHARE, MIN_QUERY, SPOTIFY_RESULTS_MS, NOTHING, depsOf, within, youtubeOf, findSongs };
export type { SearchDeps, Found, Song, SongResults };
