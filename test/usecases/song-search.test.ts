// src/usecases/song-search.ts 의 findSongs(대시보드 곡 추가 칸의 검색): 섞기, 예정 영상, 연령 인증, 스포티파이 준비와 마감, 유튜브 실패

import { test } from "node:test";
import assert from "node:assert/strict";
import { findSongs, type SearchDeps } from "../../src/usecases/song-search.ts";
import type { TrackInfo } from "../../src/player/track.ts";
import type { SpotifyTrack } from "../../src/sources/spotify.ts";

const yt = (id: string, extra: Partial<TrackInfo> = {}): TrackInfo => ({ title: `유튜브 ${id}`, artist: "가수", duration: 200, thumbnail: null, platform: "youtube", id, pageUrl: `https://www.youtube.com/watch?v=${id}`, requestKey: `https://www.youtube.com/watch?v=${id}`, audioUrl: `https://www.youtube.com/watch?v=${id}`, isLive: false, liveStatus: null, ...extra });
const sp = (id: string): SpotifyTrack => ({ title: `스포티파이 ${id}`, artist: "가수", album: "앨범", duration: 180, thumbnail: null, platform: "spotify", pageUrl: `https://open.spotify.com/track/${id}`, requestKey: `https://open.spotify.com/track/${id}`, id });
const ids = (r: { songs: { title: string | null }[] }) => r.songs.map((s) => s.title);

// 유튜브 n 곡, 스포티파이 m 곡을 주는 가짜
function deps({ youtube = 12, spotify = 5, gated = false, ready = true, spotifyMs = 0 }: { youtube?: number; spotify?: number; gated?: boolean; ready?: boolean; spotifyMs?: number } = {}): SearchDeps & { spotifyCalls: number } {
  const out = {
    spotifyCalls: 0,
    search: async () => ({ tracks: Array.from({ length: youtube }, (_, i) => yt(String(i))), gated }),
    searchSpotify: async () => {
      out.spotifyCalls++;
      await new Promise((r) => setTimeout(r, spotifyMs));
      return Array.from({ length: spotify }, (_, i) => sp(String(i)));
    },
    spotifyReady: () => ready,
  };
  return out;
}

test("유튜브 7곡에 스포티파이 3곡을 섞는다(/search 와 같은 몫)", async () => {
  const r = await findSongs("아이유", deps());
  assert.equal(r.songs.length, 10);
  assert.deepEqual(ids(r).slice(6), ["유튜브 6", "스포티파이 0", "스포티파이 1", "스포티파이 2"]);
  assert.equal(r.gated, false);
});

test("스포티파이가 준비되지 않았으면 부르지 않고 유튜브만", async () => {
  const d = deps({ ready: false });
  const r = await findSongs("아이유", d);
  assert.equal(d.spotifyCalls, 0, "준비를 시작시키지 않는다");
  assert.equal(r.songs.length, 10);
  assert.ok(r.songs.every((s) => s.platform === "youtube"));
});

test("예정 영상은 섞기 전에 빼고 그 자리를 다시 채운다. 방송 중인 영상은 남긴다", async () => {
  const d = deps({ spotify: 0 });
  d.search = async () => ({ tracks: [yt("a", { isLive: true, liveStatus: "is_upcoming", duration: 0 }), yt("b", { isLive: true, liveStatus: "is_live", duration: 0 }), ...Array.from({ length: 10 }, (_, i) => yt(String(i)))], gated: false });
  const r = await findSongs("라디오", d);
  assert.equal(r.songs.length, 10);
  assert.ok(!ids(r).includes("유튜브 a"), "예정 영상");
  assert.equal(ids(r)[0], "유튜브 b", "방송 중");
});

test("연령 인증: 유튜브가 안내만 주면 스포티파이로 채우고, 스포티파이도 없으면 gated", async () => {
  const withSpotify = await findSongs("연령", deps({ youtube: 0, gated: true, spotify: 4 }));
  assert.deepEqual([withSpotify.songs.length, withSpotify.gated], [4, false]);
  const without = await findSongs("연령", deps({ youtube: 0, gated: true, spotify: 0 }));
  assert.deepEqual([without.songs.length, without.gated], [0, true]);
});

test("유튜브가 실패하면 던진다(부르는 쪽이 까닭을 알린다). 스포티파이가 실패하면 유튜브만", async () => {
  const d = deps();
  d.search = async () => {
    throw Object.assign(new Error("429"), { code: "rate-limited" });
  };
  await assert.rejects(findSongs("아이유", d), { code: "rate-limited" });

  const s = deps();
  s.searchSpotify = async () => {
    throw new Error("spotify down");
  };
  const r = await findSongs("아이유", s);
  assert.ok(r.songs.length === 10 && r.songs.every((one) => one.platform === "youtube"));
});

test("같은 곡(출처, 제목, 가수, 길이)은 하나만", async () => {
  const d = deps({ spotify: 0 });
  d.search = async () => ({ tracks: [yt("a"), { ...yt("a2"), title: "유튜브 a" }, yt("b")], gated: false });
  assert.deepEqual(ids(await findSongs("중복", d)), ["유튜브 a", "유튜브 b"]);
});
