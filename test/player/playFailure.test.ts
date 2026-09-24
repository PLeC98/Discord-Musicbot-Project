// src/player/playFailure.ts — 재생 실패를 로그 한 줄로. 같은 실패가 두 줄씩, yt-dlp 원문 그대로 찍히던 것을 줄였다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { failureReason } from "../../src/player/playFailure.ts";
import { ErrorHandler } from "../../src/ui/errorMessages.ts";
import * as YouTube from "../../src/sources/youtube/index.ts";

const HINT = " Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ  for how to manually pass cookies.";
const AGE = `ERROR: [youtube] hc0ZDaAZQT0: Sign in to confirm your age.${HINT}`;
const COOKIE_WARN = "WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.";

// yt-dlp 를 실행하는 곳이 붙이는 모양(message = stderr, code = 이름)
const ytdlpError = (stderr: string) => Object.assign(new Error(stderr), { stderr, code: YouTube.codeOf(new Error(stderr)) ?? undefined });

test("연령 제한은 쿠키가 없어서인지, 쿠키가 무효인지, 쿠키로도 안 되는지 가른다. 영상 id 를 붙인다", () => {
  assert.equal(failureReason(ytdlpError(AGE), false), "연령 제한 · 쿠키 없음 (hc0ZDaAZQT0)");
  assert.equal(failureReason(ytdlpError(AGE), true), "연령 제한 · 쿠키로도 재생 불가 (hc0ZDaAZQT0)");
  assert.equal(failureReason(ytdlpError(`${COOKIE_WARN}\n${AGE}`), true), "연령 제한 · 쿠키가 무효. 쿠키를 다시 넣어 주세요 (hc0ZDaAZQT0)");
});

test("쿠키가 무효이면 사용자에게는 일시적이라고 알린다", () => {
  assert.equal(ErrorHandler.getMessage(ytdlpError(`${COOKIE_WARN}\n${AGE}`)), "❌ 연령 제한 영상을 일시적으로 재생할 수 없어요. 오류가 계속되면 봇 운영자에게 알려주세요.");
  assert.equal(ErrorHandler.getMessage(ytdlpError(AGE)), "❌ 연령 제한 영상은 재생할 수 없어요.");
});

test("무엇이 막았는지 분명한 종류는 이름만 남긴다", () => {
  assert.equal(failureReason(ytdlpError("ERROR: [youtube] abcdefghijk: Video unavailable"), false), "비공개이거나 삭제된 영상 (abcdefghijk)");
});

test("그 밖은 원문의 ERROR 줄, 없으면 첫 줄을 남긴다", () => {
  assert.equal(failureReason(new Error("WARNING: 무언가\nERROR: 진짜 까닭\n덧붙인 줄"), false), "ERROR: 진짜 까닭");
  assert.equal(failureReason(new Error("ffmpeg exited with code 1\n자세한 것"), false), "ffmpeg exited with code 1", "문장이 넓게 걸리는 종류는 이름으로 덮지 않는다");
  assert.equal(failureReason("그냥 글자", false), "그냥 글자");
});
