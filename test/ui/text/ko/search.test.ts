// src/ui/text/ko/search.ts: 검색 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as search from "../../../../src/ui/text/ko/search.ts";

test("결과 화면의 문장", () => {
  assert.deepEqual(
    [
      search.resultsTitle("노래 *강조*"),
      search.resultLine(1, { title: "곡 [1]", link: "https://www.youtube.com/watch?v=aaaaaaaaaaa", source: "🔴", artist: "채널", length: "3:00" }),
      search.resultLine(2, { title: null, link: "https://open.spotify.com/track/x", source: "🟢", artist: undefined, length: "알 수 없음" }),
      search.gatedFooter(),
      search.pickPlaceholder(),
      search.pickOption(1, { title: "곡", artist: "채널", length: "3:00" }),
      search.pickOption(2, { title: null, artist: null, length: "🔴LIVE" }),
      search.unknownLength(),
      search.addingTrack("곡 *제목*"),
      search.addingTrack(null),
      search.searching("노래"),
    ],
    ['"노래 \\*강조\\*" 검색 결과', "**1.** [곡 [1]](https://www.youtube.com/watch?v=aaaaaaaaaaa)\n-# 🔴 채널 | 3:00", "**2.** [알 수 없는 곡](https://open.spotify.com/track/x)\n-# 🟢 알 수 없음", "유튜브가 연령 인증을 요구하는 검색어예요", "여기를 눌러 추가할 곡을 골라 주세요!", { label: "1. 곡", description: "채널 | 3:00" }, { label: "2. 알 수 없는 곡", description: "🔴LIVE" }, "알 수 없음", "🔄 **곡 \\*제목\\*** 추가하는 중...", "🔄 곡을 추가하는 중...", "🔄 **노래** 검색 중..."],
  );
});

test("자동완성의 문장: 맨 위 줄, 곡 후보, 고친 이름에서 검색어 꺼내기", () => {
  assert.deepEqual([search.resultsChoice("노래"), search.songChoice({ title: "곡", artist: "가수", length: "3:00" }), search.songChoice({ title: null, length: "🔴LIVE" }), search.songChoice({ title: "곡", artist: "가수", length: "3:00", spotify: true })], ['🔍 "노래" 검색 결과 보기', "곡 - 가수 (3:00)", "알 수 없는 곡 (🔴LIVE)", "곡 - 가수 (3:00) (Spotify)"]);
  assert.deepEqual(['🔍 "노래" 검색 결과 보기', '🔍 "노', "곡 - 가수 (3:00)", "곡 - 가수 (1:02:03) (Spotify)", "그냥 검색어"].map(search.queryOfTyped), ["노래", "노", "곡 - 가수", "곡 - 가수", "그냥 검색어"]);
});
