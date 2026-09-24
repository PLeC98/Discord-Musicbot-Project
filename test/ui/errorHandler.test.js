// src/ui/errorMessages.js — 오류 분류 및 사용자 메시지 매핑

import { test } from "node:test";
import assert from "node:assert/strict";
import ErrorHandler from "../../src/ui/errorMessages.ts";

const CASES = [
  // [실제 yt-dlp/네트워크에서 나오는 형태의 메시지, 기대 범주]
  ["Sign in to confirm you're not a bot. This helps protect our community.", "bot-check"],
  ["ERROR: [youtube] abc: This video is age-restricted", "age-restricted"],
  ["Private video. Sign in if you've been granted access", "video-unavailable"],
  ["ERROR: [youtube] xyz: Video unavailable. This video has been removed", "video-unavailable"],
  ["Video not available in your country", "geo-blocked"],
  ["HTTP Error 429: Too Many Requests", "rate-limited"],
  ["YouTube equivalent not found", "no-youtube-match"],
  ["Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ''''''", "no-youtube-match"], // MusicPlayer · streamUrl 이 던지는 한글 메시지
  ["read ECONNRESET", "network"],
  ["connect ETIMEDOUT 1.2.3.4:443", "network"],
  ["FFmpeg exited with code 1", "stream-failed"],
  ["Missing Permissions", "voice-permission"],
  ["완전히 알 수 없는 무언가", "unknown"],
];

test("classify: 대표 메시지 분류", () => {
  for (const [msg, expected] of CASES) {
    assert.equal(ErrorHandler.classify(new Error(msg)), expected, JSON.stringify(msg));
  }
});

test("classify: Error 객체와 문자열 입력 동일 취급", () => {
  assert.equal(ErrorHandler.classify("read ECONNRESET"), "network");
  assert.equal(ErrorHandler.classify(new Error("read ECONNRESET")), "network");
});

test("classify: null/빈 입력은 unknown", () => {
  assert.equal(ErrorHandler.classify(null), "unknown");
  assert.equal(ErrorHandler.classify(""), "unknown");
});

test("getMessage: 모든 범주가 한국어 안내 문자열을 반환", () => {
  for (const [msg] of CASES) {
    const out = ErrorHandler.getMessage(new Error(msg));
    assert.equal(typeof out, "string");
    assert.ok(out.startsWith("❌"), out.slice(0, 20));
  }
});

test("handle: 던지지 않고 사용자 메시지 반환 (catch 블록 계약)", () => {
  const out = ErrorHandler.handle(new Error("read ECONNRESET"), "test-context");
  assert.equal(out, ErrorHandler.getMessage(new Error("read ECONNRESET")));
});
