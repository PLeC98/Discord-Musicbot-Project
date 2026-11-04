// dashboard/src/utils/typed-url.ts: 곡 추가 입력란의 글이 주소인가(주소면 검색하지 않는다). 애매하면 검색이다

import { test } from "node:test";
import assert from "node:assert/strict";
import { typedUrl } from "../../../dashboard/src/utils/typed-url.ts";

test("봇이 링크로 받는 것, 치는 중인 주소, 스킴 없는 주소는 주소", () => {
  for (const raw of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "spotify:track:4uLU6hMCjMI75M1A2tKUQC", "https://", "http://you", "youtube.com/watch?v=abc", "youtu.be/abc", "open.spotify.com/album/1", "www.example.com", "example.com/song"]) {
    assert.equal(typedUrl(raw), true, raw);
  }
});

test("주소 조각이 든 검색어, 점이 든 이름, 빈 글은 검색", () => {
  for (const raw of ["", "  ", "아이유 좋은 날", "youtube", "www", "https", "youtube 노래 모음", "will.i.am", "Mr.Children", "example.com 노래"]) {
    assert.equal(typedUrl(raw), false, raw);
  }
});
