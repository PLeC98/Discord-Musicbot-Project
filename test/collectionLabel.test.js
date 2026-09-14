"use strict";

// 여러 곡을 담은 출처(재생목록·앨범·아티스트)를 구분해 대기열 추가를 안내한다

const { test } = require("node:test");
const assert = require("node:assert/strict");
const TrackResolver = require("../src/TrackResolver");
const Spotify = require("../src/Spotify");
const YouTube = require("../src/YouTube");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const { collectionLabel } = require("../src/strings");

function stub(obj, key, fn) {
  const original = obj[key];
  obj[key] = fn;
  return () => (obj[key] = original);
}

const songs = (n) => Array.from({ length: n }, (_, i) => ({ title: `곡${i}` }));

test("스포티파이 링크의 종류가 collection으로 실린다", async () => {
  const restore = stub(Spotify, "getFromURL", async () => songs(3));
  try {
    for (const [url, expected] of [
      ["https://open.spotify.com/album/1IugbCvkbYTkcCcD0WbQHe", "album"],
      ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "playlist"],
      ["https://open.spotify.com/artist/0du5cEVh5yTK9QJze8zA0C", "artist"],
    ]) {
      const r = await TrackResolver.getTrackData(url, "g1");
      assert.equal(r.isPlaylist, true, url);
      assert.equal(r.collection, expected, url);
    }
    const single = await TrackResolver.getTrackData("https://open.spotify.com/track/3385Kx5khQ1JpCVFJjKAPa", "g1");
    assert.equal(single.isPlaylist, false);
    assert.equal(single.collection, null);
  } finally {
    restore();
  }
});

test("유튜브 재생목록은 playlist", async () => {
  const restore = stub(YouTube, "getPlaylist", async () => ({ tracks: songs(2) }));
  try {
    const r = await TrackResolver.getTrackData("https://www.youtube.com/playlist?list=PL123", "g1");
    assert.equal(r.collection, "playlist");
  } finally {
    restore();
  }
});

test("안내 문구가 출처 이름을 따른다", () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  assert.equal(mem.createQueueAdditionMessage(songs(11), collectionLabel("album")), "✅ 앨범의 11개 노래가 대기열에 추가되었습니다!");
  assert.equal(mem.createQueueAdditionMessage(songs(10), collectionLabel("artist"), true), "⏫ 아티스트 인기곡의 10개 노래가 대기열 맨 앞에 추가되었습니다!");
  assert.equal(mem.createQueueAdditionMessage(songs(5), collectionLabel(undefined)), "✅ 재생목록의 5개 노래가 대기열에 추가되었습니다!", "종류를 모르면 재생목록");
  assert.match(mem.createQueueAdditionMessage([{ title: "곡" }], null), /\*\*곡\*\*가 대기열에 추가/, "한 곡이면 제목 안내");
});
