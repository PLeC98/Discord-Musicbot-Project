// src/rules/source-url.ts: 자동재생 출처 주소를 저장할 모양. 목록을 가리키는 부분만 남는지

import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceUrl } from "../../src/rules/source-url.ts";
import { tidyGenres } from "../../src/config/schema/genres.ts";

test("스포티파이: si=, 지역 경로, spotify: URI 를 버리고 종류와 id 만", () => {
  assert.equal(sourceUrl("spotify", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123&pi=x"), "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
  assert.equal(sourceUrl("spotify", "https://open.spotify.com/intl-ko/album/1A2B3C?si=z"), "https://open.spotify.com/album/1A2B3C");
  assert.equal(sourceUrl("spotify", " spotify:artist:9Z8Y7X "), "https://open.spotify.com/artist/9Z8Y7X");
});

test("유튜브: pp=, start_radio=, 영상 v= 를 버리고 재생목록 주소로", () => {
  assert.equal(sourceUrl("youtube", "https://www.youtube.com/playlist?list=PL4fGSI1pDJn6jXS_Tv_N9B8Z0HTRVJE0m&pp=gAQB"), "https://www.youtube.com/playlist?list=PL4fGSI1pDJn6jXS_Tv_N9B8Z0HTRVJE0m");
  assert.equal(sourceUrl("youtube", "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDCLAK5uy_mgu07-HoqLSU-WqjK2ldEQWLuPPm3CAy8&start_radio=1"), "https://www.youtube.com/playlist?list=RDCLAK5uy_mgu07-HoqLSU-WqjK2ldEQWLuPPm3CAy8");
});

test("유튜브: 어느 모양의 주소든 실린 list 를 읽는다. 값은 통째로 id 글자여야 하고 퍼센트 인코딩은 푼다", () => {
  assert.equal(sourceUrl("youtube", "https://www.youtube.com/embed/abcdefghijk?list=PLabcdefghij"), "https://www.youtube.com/playlist?list=PLabcdefghij");
  assert.equal(sourceUrl("youtube", "https://www.youtube.com/channel/UCabc?list=PLabcdefghij"), "https://www.youtube.com/playlist?list=PLabcdefghij");
  assert.equal(sourceUrl("youtube", "https://www.youtube.com/watch?v=abcdefghijk&list=PL%2Dabc"), "https://www.youtube.com/playlist?list=PL-abc");
  for (const odd of ["https://www.youtube.com/watch?v=abcdefghijk&list=PLabc+y", "https://www.youtube.com/watch?v=abcdefghijk#t=3&list=PLabc", "https://www.youtube.com/watch?v=abcdefghijk&list=&list=PLyyy"]) {
    assert.equal(sourceUrl("youtube", odd), odd, odd);
  }
});

test("모양을 모르는 주소는 그대로 둔다(검사, 실행이 판단한다)", () => {
  assert.equal(sourceUrl("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "재생목록이 없는 영상 주소");
  assert.equal(sourceUrl("youtube", "https://example.com/x?list=PL1"), "https://example.com/x?list=PL1", "유튜브가 아닌 주소");
  assert.equal(sourceUrl("spotify", "https://example.com/playlist/1"), "https://example.com/playlist/1");
  assert.equal(sourceUrl("keyword", "https://open.spotify.com/playlist/1?si=a"), "https://open.spotify.com/playlist/1?si=a", "주소 출처가 아니면 손대지 않는다");
});

test("장르 문서: 출처 주소만 다듬고 나머지와 원본은 그대로", () => {
  const doc = {
    defaults: { prefetchCount: 1 },
    genres: {
      pop: {
        label: "팝",
        sources: [
          { type: "spotify", url: "https://open.spotify.com/playlist/AAA?si=x", weight: 2 },
          { type: "keyword", keywords: ["a"] },
        ],
      },
      broken: null,
    },
  };
  const before = structuredClone(doc);
  const tidied = tidyGenres(doc) as typeof doc;
  assert.equal(tidied.genres.pop.sources[0].url, "https://open.spotify.com/playlist/AAA");
  assert.deepEqual(tidied.genres.pop.sources[1], { type: "keyword", keywords: ["a"] });
  assert.equal(tidied.genres.broken, null, "모양이 다른 곳은 검사가 잡도록 둔다");
  assert.deepEqual(doc, before, "받은 값을 고치지 않는다");
  assert.equal(tidyGenres("x"), "x");
});
