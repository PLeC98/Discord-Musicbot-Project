// src/rules/failureReason.ts — 재생 실패를 로그 한 줄로. 같은 실패가 두 줄씩, yt-dlp 원문 그대로 찍히던 것을 줄였다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { failureReason } from "../../src/rules/failureReason.ts";
import { errorMessage } from "../../src/ui/errorMessages.ts";
import { ytDlpError } from "../helpers/errors.ts";
import { codedError } from "../../src/rules/errorKind.ts";
import { plainText } from "../helpers/notice.ts";

const HINT = " Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ  for how to manually pass cookies.";
const AGE = `ERROR: [youtube] hc0ZDaAZQT0: Sign in to confirm your age.${HINT}`;
const COOKIE_WARN = "WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.";

// yt-dlp 를 실행하는 곳이 붙이는 모양(message = stderr, code = 이름)
const ytdlpError = ytDlpError;

test("연령 제한은 쿠키가 없어서인지, 쿠키가 무효인지, 쿠키로도 안 되는지 가른다. 영상 id 를 붙인다", () => {
  assert.equal(failureReason(ytdlpError(AGE), false), "연령 제한 · 쿠키 없음 (hc0ZDaAZQT0)");
  assert.equal(failureReason(ytdlpError(AGE), true), "연령 제한 · 쿠키로도 재생 불가 (hc0ZDaAZQT0)");
  assert.equal(failureReason(ytdlpError(`${COOKIE_WARN}\n${AGE}`), true), "연령 제한 · 쿠키가 무효. 쿠키를 다시 넣어 주세요 (hc0ZDaAZQT0)");
});

test("쿠키가 무효이면 사용자에게는 일시적이라고 알린다", () => {
  assert.equal(plainText(errorMessage(ytdlpError(`${COOKIE_WARN}\n${AGE}`))), "일시적으로 연령 제한 영상을 틀 수 없어요!\n오류가 계속되면 봇 운영자에게 알려주세요.");
  assert.equal(plainText(errorMessage(ytdlpError(AGE))), "연령 제한 영상은 틀 수 없어요!\n제한되지 않은 곡을 틀어주세요.");
});

test("무엇이 막았는지 분명한 종류는 이름만 남긴다", () => {
  assert.equal(failureReason(ytdlpError("ERROR: [youtube] abcdefghijk: Video unavailable"), false), "없거나 비공개 · 삭제된 곡 (abcdefghijk)");
});

test("그 밖은 원문의 ERROR 줄, 없으면 첫 줄을 남긴다", () => {
  assert.equal(failureReason(new Error("WARNING: 무언가\nERROR: 진짜 까닭\n덧붙인 줄"), false), "ERROR: 진짜 까닭");
  assert.equal(failureReason(new Error("ffmpeg exited with code 1\n자세한 것"), false), "ffmpeg exited with code 1", "문장이 넓게 걸리는 종류는 이름으로 덮지 않는다");
  assert.equal(failureReason("그냥 글자", false), "그냥 글자");
});

// 사용자는 설정을 만질 수 없다. 사용자 문장에는 무엇이 안 됐는지만, 고치는 법은 운영자 로그에(계획서 #24)
test("봇 감지 · 요청 제한: 고치는 법(쿠키 · bgutil)은 로그 줄에만 붙고 사용자 문장에는 없다", () => {
  const bot = ytdlpError("ERROR: [youtube] abcdefghijk: Sign in to confirm you're not a bot");
  const limited = ytdlpError("ERROR: [youtube] abcdefghijk: HTTP Error 429: Too Many Requests");
  assert.match(failureReason(bot, false), /^봇 감지 \(운영자: .*COOKIES_SOURCE.*\) \(abcdefghijk\)$/);
  assert.match(failureReason(limited, false), /^요청 제한 \(운영자: .*COOKIES_SOURCE.*\) \(abcdefghijk\)$/);
  for (const error of [bot, limited]) {
    const told = plainText(errorMessage(error));
    assert.doesNotMatch(told, /\.env|COOKIES_SOURCE|bgutil/, told);
    assert.match(told, /봇 운영자에게 알려주세요/);
  }
});

// 사용자 문장을 일반화하려 감싼 오류(직접 링크)는 사유가 원인에만 있다. 로그 한 줄에 붙인다
test("감싼 오류는 원인의 첫 줄을 붙인다", () => {
  const wrapped = codedError("direct-unavailable", "재생할 수 없는 링크입니다", { cause: new Error("요청 실패: HTTP 404\n자세한 것") });
  assert.equal(failureReason(wrapped, false), "재생할 수 없는 링크입니다 (요청 실패: HTTP 404)");
});

// 원인의 ERROR 줄을 그대로 글로 삼은 오류(사운드클라우드)는 같은 줄이 두 번 찍혔다(실사용)
test("원인의 첫 줄이 오류와 같으면 다시 붙이지 않는다. 이름이 있는 종류는 이름으로", () => {
  const line = "ERROR: [soundcloud] a/weird: Unable to download JSON metadata: HTTP Error 500";
  const same = codedError("stream-failed", line, { cause: new Error(`${line}\nmore`) });
  assert.equal(failureReason(same, false), line);
  const gone = codedError("unavailable-playlist", "ERROR: [soundcloud:set] discover/sets/x: HTTP Error 404", { cause: new Error("ERROR: [soundcloud:set] discover/sets/x: HTTP Error 404") });
  assert.equal(failureReason(gone, false), "없거나 비공개인 재생목록");
});
