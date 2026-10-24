// src/ui/error-messages.ts — 오류 종류와 사용자 문장

import { test } from "node:test";
import assert from "node:assert/strict";
import { addFailureMessage, errorMessage, reportError } from "../../src/ui/error-messages.ts";
import * as text from "../../src/ui/text/ko/errors.ts";
import { errorKind } from "../../src/rules/error-kind.ts";
import { codedError } from "../../src/rules/error-kind.ts";
import { networkError, ytDlpError } from "../helpers/errors.ts";
import { plainText } from "../helpers/notice.ts";

// [실제로 들어오는 모양의 오류, 기대 범주]. yt-dlp 는 실행하는 곳이, 우리 코드는 만든 곳이, Node · 디스코드는 저마다 이름을 단다
const CASES: Array<[Error, string]> = [
  [ytDlpError("Sign in to confirm you're not a bot. This helps protect our community."), "yt-bot-check"],
  [ytDlpError("ERROR: [youtube] abc: This video is age-restricted"), "yt-age-no-cookies"],
  [ytDlpError("Private video. Sign in if you've been granted access"), "unavailable-contents"],
  [ytDlpError("ERROR: [youtube] xyz: Video unavailable. This video has been removed"), "unavailable-contents"],
  [ytDlpError("Video not available in your country"), "geo-blocked"],
  [ytDlpError("HTTP Error 429: Too Many Requests"), "rate-limited"],
  [codedError("sp-no-youtube-match", "Spotify 트랙의 YouTube 동등물을 찾을 수 없음: 곡"), "sp-no-youtube-match"], // Player · streamUrl
  [Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), "network-error"],
  [Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT" }), "network-error"],
  [networkError(), "network-error"],
  [codedError("stream-failed", "오디오 리소스를 만들지 못했습니다"), "stream-failed"],
  [Object.assign(new Error("Missing Permissions"), { code: 50013, url: "https://discord.com/api/v10/channels/1/messages" }), "permission-text"], // DiscordAPIError
  [new Error("완전히 알 수 없는 무언가"), "unknown-error"],
];

test("classify: 대표 오류 분류", () => {
  for (const [error, expected] of CASES) {
    assert.equal(errorKind(error), expected, error.message);
  }
});

test("classify: 글만 있는 문자열은 이름이 없어 unknown", () => {
  assert.equal(errorKind("read ECONNRESET"), "unknown-error");
});

test("classify: null/빈 입력은 unknown", () => {
  assert.equal(errorKind(null), "unknown-error");
  assert.equal(errorKind(""), "unknown-error");
});

test("getMessage: 모든 범주가 헤더 줄이 있는 안내를 돌려준다", () => {
  for (const [error] of CASES) {
    const out = errorMessage(error);
    assert.ok(out.title.length > 0, out.topic);
    assert.ok(!out.title.startsWith("❌") && !out.title.startsWith("**"), out.title);
  }
});

test("handle: 던지지 않고 사용자 메시지 반환 (catch 블록 계약)", () => {
  const out = reportError(new Error("read ECONNRESET"), "test-context");
  assert.deepEqual(out, errorMessage(new Error("read ECONNRESET")));
});

test("곡을 찾거나 담지 못한 결과: 까닭의 문장이 먼저, 오류로 못 했으면 그 종류, 아니면 곡을 틀 수 없다", () => {
  assert.deepEqual(addFailureMessage({ code: "voice-failed", kind: "network-error" }), text.notice("voice-failed"), "까닭의 문장이 있으면 오류 종류보다 먼저");
  assert.deepEqual(addFailureMessage({ code: "play-failed", kind: "network-error" }), text.notice("network-error"));
  assert.deepEqual(addFailureMessage({ code: "play-threw" }), text.notice("unknown-error"), "던진 것은 종류를 몰라도 오류 문장");
  assert.deepEqual(addFailureMessage({ code: "lookup-failed" }), text.notice("unknown-error"));
  assert.deepEqual(addFailureMessage({ code: "play-failed" }), text.notice("cannot-start"));
  assert.deepEqual(addFailureMessage({ code: "live-ended" }), text.notice("live-ended"));
  assert.equal(plainText(addFailureMessage({ code: "more-nothing-playable", skipped: 3 })), "해당 구간에는 재생할 수 없는 곡뿐이에요.\n미리듣기나 지역 제한 등이 걸린 곡들이라 넣지 못했어요. (3곡)");
});
