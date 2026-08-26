"use strict";

// Tier-1 매핑 조회/삭제 + 영상 내려감 판별 (Phase 2: 재생목록 항목 유튜브 검색 스킵 + 죽은 캐시 재검색).

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const DB_PATH = path.join(os.tmpdir(), `musicbot-cacheres-test-${process.pid}.db`);
let CacheManager;
let YouTube;

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  CacheManager = require("../src/CacheManager");
  CacheManager.initialize(DB_PATH);
  YouTube = require("../src/YouTube");
});

after(() => {
  if (CacheManager) CacheManager.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    /* 무시 */
  }
});

test("getResolvedKey: 매핑만 있으면 파일 없어도 audioSourceKey 반환", () => {
  const spUrl = "https://open.spotify.com/track/abc123";
  assert.equal(CacheManager.getResolvedKey(spUrl), null); // 없음
  // audio_cache 행 생성(FK) 후 매핑 기록 — 파일은 만들지 않음
  CacheManager.recordDownloadStart("yt:vidAAA", { title: "t" });
  CacheManager.recordTrackLookup(spUrl, "spotify", "yt:vidAAA", "t", "a", null);
  assert.equal(CacheManager.getResolvedKey(spUrl), "yt:vidAAA"); // 파일 없이도 히트
});

test("removeResolution: 스테일 매핑 삭제", () => {
  const spUrl = "https://open.spotify.com/track/abc123";
  assert.equal(CacheManager.getResolvedKey(spUrl), "yt:vidAAA");
  CacheManager.removeResolution(spUrl);
  assert.equal(CacheManager.getResolvedKey(spUrl), null);
});

test("getResolvedKey: 미존재 URL은 null", () => {
  assert.equal(CacheManager.getResolvedKey("https://open.spotify.com/track/none"), null);
});

test("YouTube.isVideoUnavailableError: 삭제/비공개 영상 감지", () => {
  assert.equal(YouTube.isVideoUnavailableError({ stderr: "ERROR: [youtube] X: Video unavailable" }), true);
  assert.equal(YouTube.isVideoUnavailableError({ stderr: "This video is no longer available" }), true);
  assert.equal(YouTube.isVideoUnavailableError(new Error("This video has been removed by the uploader")), true);
  assert.equal(YouTube.isVideoUnavailableError({ message: "Private video. Sign in if you've been granted access" }), true);
});

test("YouTube.isVideoUnavailableError: 일시적/연령/봇 오류는 false (재검색 금지)", () => {
  assert.equal(YouTube.isVideoUnavailableError(new Error("Sign in to confirm your age")), false);
  assert.equal(YouTube.isVideoUnavailableError({ stderr: "HTTP Error 429: Too Many Requests" }), false);
  assert.equal(YouTube.isVideoUnavailableError({ stderr: "Sign in to confirm you’re not a bot" }), false);
  assert.equal(YouTube.isVideoUnavailableError(new Error("getaddrinfo ENOTFOUND")), false);
  assert.equal(YouTube.isVideoUnavailableError(null), false);
});

test("YouTube._isVideoEntry: 비디오만 통과, 채널/재생목록 제외", () => {
  // 비디오 (11자 id / watch URL)
  assert.equal(YouTube._isVideoEntry({ id: "UxM5UgpXYM4", url: "https://www.youtube.com/watch?v=UxM5UgpXYM4" }), true);
  assert.equal(YouTube._isVideoEntry({ id: "dQw4w9WgXcQ", ie_key: "Youtube" }), true);
  // 채널 (x0o0x_ 케이스: 검색이 아티스트 채널을 반환) — 제외
  assert.equal(YouTube._isVideoEntry({ id: "UCxIzG0XIBe1XMh5dz-qUkVg", url: "https://www.youtube.com/channel/UCxIzG0XIBe1XMh5dz-qUkVg", ie_key: "YoutubeTab" }), false);
  assert.equal(YouTube._isVideoEntry({ url: "https://www.youtube.com/@somehandle" }), false);
  assert.equal(YouTube._isVideoEntry({ id: "PLxxxxxxxx", url: "https://www.youtube.com/playlist?list=PLxxxx" }), false);
  assert.equal(YouTube._isVideoEntry(null), false);
});
