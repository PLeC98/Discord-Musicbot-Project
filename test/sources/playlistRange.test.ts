// 여러 곡 출처는 필요한 구간만 받는다 — 스포티파이 재생목록·앨범·인기곡, 유튜브 재생목록, 해석기 전달.
// 회귀 대상: 1만 곡 재생목록을 전부 받은 뒤(61초) 대기열에서 잘랐다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { YtDlpFlags } from "../../src/sources/ytdlpSpawn.ts";
import type { Range } from "../../src/sources/lookup.ts";
import * as tracks from "../helpers/tracks.ts";

// yt-dlp 실행 함수 가짜. getPlaylist 에 넘긴다
const ytCalls: Array<{ url: string; options: YtDlpFlags }> = [];
let ytInfo: unknown = null;
const exec = async (url: string, options: YtDlpFlags = {}) => {
  ytCalls.push({ url, options });
  return ytInfo;
};

const Spotify = await import("../../src/sources/spotify.ts");
const YouTube = await import("../../src/sources/youtube/index.ts");
// 링크 장부는 빈 임시 DB 에서 읽는다(확인된 제목 없음)
const store = (await import("../helpers/tempStore.ts")).openTempStore("playlist-range-");
after(() => store.close());
const lookup = await import("../../src/sources/lookup.ts");

const { graphql, official } = Spotify._internals;

// ── 스포티파이 재생목록 (익명 GraphQL) ──

function fakePlaylist(total: number, unavailable = new Set<number>()) {
  const calls: Array<[number, number]> = [];
  const query = async (_op: string, _hash: string, variables: Record<string, unknown>) => {
    const { offset, limit } = variables as { offset: number; limit: number };
    calls.push([offset, limit]);
    const items = [];
    for (let i = offset; i < Math.min(total, offset + limit); i++) {
      const data = unavailable.has(i) ? { __typename: "NotFound" } : { name: `곡${i}`, uri: `spotify:track:t${i}`, artists: { items: [] }, trackDuration: { totalMilliseconds: 1000 } };
      items.push({ itemV2: { __typename: "TrackResponseWrapper", data } });
    }
    return { playlistV2: { __typename: "Playlist", content: { totalCount: total, items } } };
  };
  return { calls, query };
}

async function playlist(total: number, range: Range, unavailable?: Set<number>) {
  const fake = fakePlaylist(total, unavailable);
  return { ...(await graphql.playlist("P", range, { query: fake.query })), calls: fake.calls };
}

test("스포티파이 재생목록: 요청한 만큼만 페이지를 나눠 받고 총 곡 수를 돌려준다", async () => {
  const r = await playlist(1000, { offset: 0, limit: 150 });
  assert.deepEqual(r.calls, [
    [0, 100],
    [100, 50],
  ]);
  assert.equal(r.tracks.length, 150);
  assert.equal(r.total, 1000);
  assert.equal(r.nextOffset, 150);
});

test("스포티파이 재생목록: 중간 구간은 요청 한 번이다", async () => {
  const r = await playlist(9946, { offset: 5000, limit: 50 });
  assert.deepEqual(r.calls, [[5000, 50]]);
  assert.equal(r.tracks[0].title, "곡5000");
});

test("스포티파이 재생목록: 재생할 수 없는 곡은 건너뛰어 채우고, 다음 위치는 원본 기준이다", async () => {
  const r = await playlist(1000, { offset: 0, limit: 100 }, new Set([3, 4, 5]));
  assert.deepEqual(r.calls, [
    [0, 100],
    [100, 3],
  ]);
  assert.equal(r.tracks.length, 100);
  assert.equal(r.nextOffset, 103);
});

test("스포티파이 재생목록: 목록 끝에서 멈춘다", async () => {
  const r = await playlist(120, { offset: 0, limit: 500 });
  assert.deepEqual(r.calls, [
    [0, 100],
    [100, 100],
  ]);
  assert.equal(r.tracks.length, 120);
  assert.equal(r.nextOffset, 120);
});

// ── 스포티파이 앨범 (공식 API) ──

function apiItems(from: number, to: number) {
  return Array.from({ length: to - from }, (_, k) => ({ name: `곡${from + k}`, id: `t${from + k}`, artists: [], duration_ms: 1000 }));
}

async function album(range: Range) {
  const pages: Record<string, unknown> = {
    "/albums/A": { name: "앨범", images: [], tracks: { total: 120, items: apiItems(0, 50), next: "/albums/A/tracks?offset=50&limit=50" } },
    "/albums/A/tracks?offset=50&limit=50": { items: apiItems(50, 100), next: "/albums/A/tracks?offset=100&limit=50" },
    "/albums/A/tracks?offset=100&limit=50": { items: apiItems(100, 120), next: null },
  };
  const gets: string[] = [];
  const get = async (p: string) => {
    gets.push(p);
    return pages[p];
  };
  return { ...(await official.album("A", range, { get })), gets };
}

test("스포티파이 앨범: 앞부분은 앨범 응답에 딸린 곡부터, 모자라면 다음 페이지", async () => {
  const r = await album({ offset: 0, limit: 60 });
  assert.deepEqual(r.gets, ["/albums/A", "/albums/A/tracks?offset=50&limit=50"]);
  assert.equal(r.tracks.length, 60);
  assert.equal(r.tracks[0].album, "앨범");
  assert.equal(r.total, 120);
  assert.equal(r.nextOffset, 60);
});

test("스포티파이 앨범: 중간부터는 그 위치의 곡 페이지를 바로 받는다", async () => {
  const r = await album({ offset: 100, limit: 50 });
  assert.deepEqual(r.gets, ["/albums/A", "/albums/A/tracks?offset=100&limit=50"]);
  assert.equal(r.tracks[0].title, "곡100");
  assert.equal(r.nextOffset, 120);
});

test("스포티파이 인기곡: 통째로 받은 뒤 구간을 자른다", async () => {
  const r = await Spotify.getCollection("https://open.spotify.com/artist/X", { limit: 3 }, { get: async () => ({ tracks: apiItems(0, 10) }) });
  assert.equal(r.tracks.length, 3);
  assert.equal(r.total, 10);
});

// ── 유튜브 재생목록 ──

test("유튜브 재생목록: 구간만 요청하고, 총 곡 수와 원본 기준 다음 위치를 돌려준다", async () => {
  ytInfo = { title: "목록", playlist_count: 98, entries: [{ id: "a", title: "A" }, { id: "b", title: "B" }, null] };
  const r = await YouTube.getPlaylist("https://www.youtube.com/playlist?list=PLx", { offset: 50, limit: 3, exec });
  assert.ok(r);
  assert.equal(ytCalls.at(-1)?.options.playlistItems, "51:53");
  assert.equal(r.tracks.length, 2);
  assert.equal(r.total, 98);
  assert.equal(r.nextOffset, 53, "빈 항목도 원본 자리를 차지한다");

  ytInfo = { title: "Mix", entries: [{ id: "a", title: "A" }] };
  const mix = await YouTube.getPlaylist("https://www.youtube.com/watch?v=a&list=RDa", { exec });
  assert.ok(mix);
  assert.equal(ytCalls.at(-1)?.options.playlistItems, "1:50", "구간을 안 주면 한 번에 넣는 묶음만큼");
  assert.equal(mix.total, null, "믹스는 끝이 없어 총 곡 수가 없다");
});

// ── 해석기 ──

test("해석기는 구간을 어댑터에 넘기고 총 곡 수·다음 위치를 싣는다", async () => {
  const seen: Array<Range | undefined> = [];
  const sources = {
    spotify: {
      ...Spotify,
      getCollection: async (_url: string, range?: Range) => {
        seen.push(range);
        return { tracks: [tracks.spotify("a")], total: 9946, nextOffset: 1 };
      },
    },
  };
  const r = await lookup.getTrackData("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "ctx", { limit: 7 }, sources);
  assert.deepEqual(seen[0], { offset: 0, limit: 7 });
  assert.equal(r.total, 9946);
  assert.equal(r.nextOffset, 1);

  const single = await lookup.getTrackData("https://open.spotify.com/track/3385Kx5khQ1JpCVFJjKAPa", undefined, undefined, sources);
  assert.equal(single.total, null, "한 곡이면 총 곡 수가 없다");
});
