"use strict";

// src/store/trackLookup.js — 링크 장부의 제목 출처와 매핑 갱신. 임시 DB 로 진짜 SQL 을 돈다.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { openTempStore } = require("../helpers/tempStore");

const store = openTempStore("track-lookup-");
after(() => store.close());
const audioCache = require("../../src/store/audioCache");
const trackLookup = require("../../src/store/trackLookup");

// ── 제목 출처 (title_verified) ───────────────────────────────
// 재생목록 페이지가 주는 제목은 같은 영상인데도 다를 수 있다. 그걸로 확인된 제목을 덮으면
// 한 번 고친 것이 도로 낡은 값으로 돌아간다 — 이 왕복이 실제 증상이었다.

const TL_URL = "https://www.youtube.com/watch?v=titletest";

// track_lookup은 audio_cache를 외래키로 참조한다 — 캐시 행이 먼저 있어야 한다.
const withCacheRow = (key) => audioCache.recordDownloadStart(key, { title: "x", duration: 1 });

test("확인되지 않은 제목은 확인된 제목을 덮지 못한다", () => {
  withCacheRow("yt:titletest");
  trackLookup.recordTrackLookup(TL_URL, "youtube", "yt:titletest", "정식 제목", "채널", null, { verified: true });
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "정식 제목");

  trackLookup.recordTrackLookup(TL_URL, "youtube", "yt:titletest", "낡은 재생목록 제목", "채널", null);
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "정식 제목", "재생목록 제목이 덮으면 안 된다");
});

test("확인된 제목은 확인된 제목으로 갱신된다 (영상 제목이 실제로 바뀐 경우)", () => {
  trackLookup.recordTrackLookup(TL_URL, "youtube", "yt:titletest", "새 정식 제목", "채널", null, { verified: true });
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "새 정식 제목");
});

test("확인된 적 없는 URL은 getVerifiedTitle이 null", () => {
  const url = "https://www.youtube.com/watch?v=unverif";
  withCacheRow("yt:unverif");
  trackLookup.recordTrackLookup(url, "youtube", "yt:unverif", "첫 제목", null, null);
  trackLookup.recordTrackLookup(url, "youtube", "yt:unverif", "둘째 제목", null, null);
  assert.equal(trackLookup.getVerifiedTitle(url), null, "미확인 제목은 여기 안 걸린다");
});

test("매핑(audio_source_key)은 출처와 무관하게 항상 갱신된다", () => {
  const url = "https://www.youtube.com/watch?v=remap";
  withCacheRow("yt:old");
  withCacheRow("yt:new");
  trackLookup.recordTrackLookup(url, "youtube", "yt:old", "제목", null, null, { verified: true });
  trackLookup.recordTrackLookup(url, "youtube", "yt:new", "낡은 제목", null, null);
  assert.equal(trackLookup.getResolvedKey(url), "yt:new", "재검색 결과가 매핑을 갱신해야 한다");
  assert.equal(trackLookup.getVerifiedTitle(url), "제목", "제목은 지켜진다");
});

test("행이 없는 URL은 getVerifiedTitle이 null", () => {
  assert.equal(trackLookup.getVerifiedTitle("https://www.youtube.com/watch?v=nosuch"), null);
});
