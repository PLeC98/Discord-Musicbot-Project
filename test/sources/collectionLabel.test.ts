// 여러 곡을 담은 출처(재생목록·앨범·아티스트)를 구분해 대기열 추가를 안내한다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as lookup from "../../src/sources/lookup.ts";
import * as Spotify from "../../src/sources/spotify.ts";
import * as YouTube from "../../src/sources/youtube/index.ts";
import { MusicEmbedManager } from "../../src/ui/nowPlayingPanel.ts";
import { collectionLabel } from "../../src/ui/strings.ts";
import type { Client } from "discord.js";
import { fake } from "../helpers/fake.ts";

const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `곡${i}` }));

test("스포티파이 링크의 종류가 collection으로 실린다", async () => {
  const sources = { spotify: { ...Spotify, getCollection: async () => ({ tracks: songs(3), total: 3, nextOffset: 3 }) } };
  for (const [url, expected] of [
    ["https://open.spotify.com/album/1IugbCvkbYTkcCcD0WbQHe", "album"],
    ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "playlist"],
    ["https://open.spotify.com/artist/0du5cEVh5yTK9QJze8zA0C", "artist"],
  ]) {
    const r = await lookup.getTrackData(url, undefined, undefined, sources);
    assert.equal(r.isPlaylist, true, url);
    assert.equal(r.collection, expected, url);
  }
  const single = await lookup.getTrackData("https://open.spotify.com/track/3385Kx5khQ1JpCVFJjKAPa", undefined, undefined, sources);
  assert.equal(single.isPlaylist, false);
  assert.equal(single.collection, null);
});

test("유튜브 재생목록은 playlist", async () => {
  const sources = { youtube: { ...YouTube, getPlaylist: async () => ({ tracks: songs(2) }) } };
  const r = await lookup.getTrackData("https://www.youtube.com/playlist?list=PL123", undefined, undefined, sources);
  assert.equal(r.collection, "playlist");
});

test("안내 문구가 출처 이름을 따른다", () => {
  const mem = new MusicEmbedManager(fake<Client>({ players: new Map() }));
  assert.equal(mem.createQueueAdditionMessage(songs(11), collectionLabel("album")), "✅ 앨범의 11개 노래가 대기열에 추가되었습니다!");
  assert.equal(mem.createQueueAdditionMessage(songs(10), collectionLabel("artist"), true), "⏫ 아티스트 인기곡의 10개 노래가 대기열 맨 앞에 추가되었습니다!");
  assert.equal(mem.createQueueAdditionMessage(songs(5), collectionLabel(undefined)), "✅ 재생목록의 5개 노래가 대기열에 추가되었습니다!", "종류를 모르면 재생목록");
  assert.match(mem.createQueueAdditionMessage([{ title: "곡" }], null), /\*\*곡\*\*가 대기열에 추가/, "한 곡이면 제목 안내");
});

test("안내 문구: 받은 것보다 목록이 크면 전체 곡 수를, 자리가 모자라 덜 받았으면 그 사실을 붙인다", () => {
  const mem = new MusicEmbedManager(fake<Client>({ players: new Map() }));
  const label = collectionLabel("playlist");
  assert.equal(mem.createQueueAdditionMessage(songs(50), label, false, { total: 9946 }), "✅ 재생목록의 50개 노래가 대기열에 추가되었습니다! (전체 9,946곡)");
  assert.match(mem.createQueueAdditionMessage(songs(5), label, false, { queueLimited: true }), /\n⚠️ 대기열이 가득 차 목록의 일부만 넣었습니다/);
  assert.doesNotMatch(mem.createQueueAdditionMessage([{ title: "곡" }], null, false, { total: 9946 }), /전체/, "한 곡 안내에는 붙이지 않는다");
});
