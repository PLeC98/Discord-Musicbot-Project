// src/ui/errorMessages.ts — 오류 분류 및 사용자 메시지 매핑

import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, reportError } from "../../src/ui/errorMessages.ts";
import { errorKind } from "../../src/rules/errorKind.ts";
import { codedError } from "../../src/rules/errorKind.ts";
import { networkError, ytDlpError } from "../helpers/errors.ts";

// [실제로 들어오는 모양의 오류, 기대 범주]. yt-dlp 는 실행하는 곳이, 우리 코드는 만든 곳이, Node · 디스코드는 저마다 이름을 단다
const CASES: Array<[Error, string]> = [
  [ytDlpError("Sign in to confirm you're not a bot. This helps protect our community."), "bot-check"],
  [ytDlpError("ERROR: [youtube] abc: This video is age-restricted"), "age-restricted"],
  [ytDlpError("Private video. Sign in if you've been granted access"), "video-unavailable"],
  [ytDlpError("ERROR: [youtube] xyz: Video unavailable. This video has been removed"), "video-unavailable"],
  [ytDlpError("Video not available in your country"), "geo-blocked"],
  [ytDlpError("HTTP Error 429: Too Many Requests"), "rate-limited"],
  [codedError("no-youtube-match", "Spotify 트랙의 YouTube 동등물을 찾을 수 없음: 곡"), "no-youtube-match"], // MusicPlayer · streamUrl
  [Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), "network"],
  [Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT" }), "network"],
  [networkError(), "network"],
  [codedError("stream-failed", "오디오 리소스를 만들지 못했습니다"), "stream-failed"],
  [Object.assign(new Error("Missing Permissions"), { code: 50013 }), "voice-permission"], // DiscordAPIError
  [new Error("완전히 알 수 없는 무언가"), "unknown"],
];

test("classify: 대표 오류 분류", () => {
  for (const [error, expected] of CASES) {
    assert.equal(errorKind(error), expected, error.message);
  }
});

test("classify: 글만 있는 문자열은 이름이 없어 unknown", () => {
  assert.equal(errorKind("read ECONNRESET"), "unknown");
});

test("classify: null/빈 입력은 unknown", () => {
  assert.equal(errorKind(null), "unknown");
  assert.equal(errorKind(""), "unknown");
});

test("getMessage: 모든 범주가 한국어 안내 문자열을 반환", () => {
  for (const [error] of CASES) {
    const out = errorMessage(error);
    assert.equal(typeof out, "string");
    assert.ok(out.startsWith("❌"), out.slice(0, 20));
  }
});

test("handle: 던지지 않고 사용자 메시지 반환 (catch 블록 계약)", () => {
  const out = reportError(new Error("read ECONNRESET"), "test-context");
  assert.equal(out, errorMessage(new Error("read ECONNRESET")));
});
