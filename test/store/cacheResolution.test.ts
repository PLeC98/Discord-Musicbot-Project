// @ts-nocheck sources/youtube 가 아직 JS 라 YouTube 의 메서드 타입이 없다. 10단계 sources 폴더에서 뗀다
// Tier-1 매핑 조회/삭제 + 영상 내려감 판별 (Phase 2: 재생목록 항목 유튜브 검색 스킵 + 죽은 캐시 재검색).

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import * as audioCache from "../../src/store/audioCache.ts";
import * as trackLookup from "../../src/store/trackLookup.ts";
import YouTube from "../../src/sources/youtube/index.ts";

const DB_PATH = path.join(os.tmpdir(), `musicbot-cacheres-test-${process.pid}.db`);

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  audioCache.initialize(DB_PATH);
});

after(() => {
  if (audioCache) audioCache.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    /* 무시 */
  }
});

test("getAudioUrl: 장부 줄만 있으면 파일이 없어도 음원 주소를 돌려준다", () => {
  const spUrl = "https://open.spotify.com/track/abc123";
  assert.equal(trackLookup.getAudioUrl(spUrl), null); // 없음
  // audio_cache 행도 파일도 없이 장부만 적는다. 장부는 캐시와 따로 산다
  trackLookup.recordTrackLookup({ requestKey: spUrl, pageUrl: spUrl, audioUrl: "https://www.youtube.com/watch?v=vidAAA", platform: "spotify", title: "t", artist: "a" });
  assert.equal(trackLookup.getAudioUrl(spUrl), "https://www.youtube.com/watch?v=vidAAA"); // 파일 없이도 히트
});

test("removeResolution: 스테일 매핑 삭제", () => {
  const spUrl = "https://open.spotify.com/track/abc123";
  assert.equal(trackLookup.getAudioUrl(spUrl), "https://www.youtube.com/watch?v=vidAAA");
  trackLookup.removeResolution(spUrl);
  assert.equal(trackLookup.getAudioUrl(spUrl), null);
});

test("getAudioUrl: 없는 요청은 null", () => {
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/none"), null);
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

// 쿠키가 죽었을 때 실제로 오는 stderr. 원인(WARNING)과 결과(ERROR)가 나뉘어 적히는데,
// 원인 쪽 "no longer valid" 가 삭제 판정의 "no longer available" 과 한 단어 차이다.
// 여기서 true 가 되면 멀쩡히 살아 있는 영상이 내려간 것으로 분류되고, 자동재생은 그 판정으로
// 곡을 영구히 버린다(markDead). 쿠키를 갈아 끼워도 되살아나지 않는다.
test("YouTube.isVideoUnavailableError: 쿠키 무효 + 연령 제한은 삭제가 아니다", () => {
  const stderr = ["WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.", "ERROR: [youtube] EahYs-8tTjQ: Sign in to confirm your age. Use --cookies-from-browser or --cookies for the authentication."].join("\n");
  const error = Object.assign(new Error("Command failed"), { stderr });

  assert.equal(YouTube.isAgeRestrictedError(error), true, "연령 제한으로는 잡혀야 한다");
  assert.equal(YouTube.isVideoUnavailableError(error), false, "내려간 영상으로 분류하면 자동재생이 곡을 버린다");
  assert.equal(YouTube.isClientFault(error), false, "클라이언트 탓으로 세면 멀쩡한 경로가 제외된다");
  assert.equal(YouTube.isStaleMediaError(error), false);
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
