// src/rules/track-art.ts — 출처마다 쓸 크기의 곡 그림 주소

import { test } from "node:test";
import assert from "node:assert/strict";
import { artOf, youtubeArt, youtubeIdOf } from "../../src/rules/track-art.ts";

test("유튜브: 영상 id 로 만든다(작은 칸 mqdefault · 큰 칸 maxresdefault). 검색 결과의 작은 그림 · 4:3 그림 · webp · 쿼리가 붙은 것도", () => {
  for (const url of ["https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg?sqp=-oaymwE&rs=AOn4", "https://i.ytimg.com/vi_webp/abcdefghijk/sddefault.webp", "https://i9.ytimg.com/vi/abcdefghijk/default.jpg", "https://img.youtube.com/vi/abcdefghijk/0.jpg"]) {
    assert.equal(artOf(url), "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg", url);
  }
  assert.equal(artOf("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", "large"), "https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg");
  assert.equal(artOf("https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg", "standard"), "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  assert.equal(youtubeIdOf("https://i.ytimg.com/vi_webp/abcdefghijk/sddefault.webp"), "abcdefghijk");
  assert.equal(youtubeIdOf("https://i1.sndcdn.com/artworks-ab-t500x500.jpg"), null);
  assert.equal(youtubeArt("abcdefghijk"), "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
});

test("사운드클라우드: 크기 접미사를 500×500 으로(16×16 · 원본 3000×3000 · 프로필 그림도)", () => {
  assert.equal(artOf("https://i1.sndcdn.com/artworks-000123-abcdef-mini.jpg"), "https://i1.sndcdn.com/artworks-000123-abcdef-t500x500.jpg");
  assert.equal(artOf("https://i1.sndcdn.com/artworks-ab-cd-original.png"), "https://i1.sndcdn.com/artworks-ab-cd-t500x500.png");
  assert.equal(artOf("https://i1.sndcdn.com/avatars-000-xyz-large.jpg"), "https://i1.sndcdn.com/avatars-000-xyz-t500x500.jpg");
  assert.equal(artOf("https://i1.sndcdn.com/artworks-ab-t500x500.jpg"), "https://i1.sndcdn.com/artworks-ab-t500x500.jpg");
});

test("그 밖은 그대로, 없으면 null", () => {
  assert.equal(artOf("https://i.scdn.co/image/ab67616d0000b273abc"), "https://i.scdn.co/image/ab67616d0000b273abc");
  assert.equal(artOf(null), null);
  assert.equal(artOf(""), null);
});
