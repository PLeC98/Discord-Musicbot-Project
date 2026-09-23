// 오류를 가르는 두 집의 지금 답을 한 표로 고정한다(구조 리팩터링 0-B).
//
// ErrorHandler.classify(사용자에게 보일 범주)와 YouTube.is*Error(재시도 · 폴백 판단)가 같은 문장을 따로 가른다.
// 두 집이 같은 문장을 같은 뜻으로 가르는지 이 표가 본다. "고친 순서" 라고 적은 행은 예전에 봇 감지로 잘못 가르던 것이다.

import { test } from "node:test";
import assert from "node:assert/strict";
import ErrorHandler from "../../src/ui/errorMessages.js";
import YouTube from "../../src/sources/youtube/index.js";
import errorKind from "../../src/rules/errorKind.js";
const { RULES } = errorKind;

// [문장, classify, 영상없음, 연령제한, 클라이언트탓, 주소어긋남, 클라이언트건너뜀]
const T = true;
const F = false;
const TABLE = [
  // 영상이 없는 경우
  ["ERROR: [youtube] abc: Video unavailable", "video-unavailable", T, F, F, F, F],
  ["ERROR: [youtube] abc: This video is unavailable", "video-unavailable", T, F, F, F, F], // 고친 순서: 봇 감지 규칙에 있던 것을 영상 없음으로. 영상 없음 정규식도 "is" 를 받는다
  ["ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "video-unavailable", T, F, F, F, F],
  ["ERROR: This video has been removed by the uploader", "video-unavailable", T, F, F, F, F],
  ["ERROR: This video is no longer available because the YouTube account associated with this video has been terminated", "video-unavailable", T, F, F, F, F],
  // 연령 제한 · 봇 감지 · 쿠키
  ["ERROR: Sign in to confirm your age. This video may be inappropriate for some users.", "age-restricted", F, T, F, F, F], // 고친 순서: 연령 제한이 봇 감지("sign in to confirm")보다 앞
  ["ERROR: Sign in to confirm you're not a bot", "bot-check", F, F, F, F, F],
  ["WARNING: The provided YouTube account cookies are no longer valid", "unknown", F, F, F, F, F], // "no longer available" 과 한 단어 차이. 영상 없음으로 가르지 않는다
  // 클라이언트 · 포맷
  ["ERROR: Requested format is not available", "unknown", F, F, T, F, F],
  ["ERROR: Only images are available for download", "unknown", F, F, T, F, F],
  ["WARNING: web client https formats require a PO Token which was not provided", "unknown", F, F, T, F, F],
  ['WARNING: Skipping client "android" since it does not support cookies\nERROR: Requested format is not available', "unknown", F, F, F, F, T],
  ["ERROR: nsig extraction failed: Some formats may be missing", "unknown", F, F, T, F, F],
  // 미디어 주소 어긋남
  ["ERROR: unable to download video data: HTTP Error 403: Forbidden", "unknown", F, F, T, T, F], // 봇 감지의 403 은 "youtube" 가 같이 있어야 한다
  ["ERROR: unable to download fragment 12", "unknown", F, F, T, T, F],
  ["HTTP Error 429: Too Many Requests", "rate-limited", F, F, T, T, F],
  // 그 밖
  ["getaddrinfo ENOTFOUND youtube.com", "network", F, F, F, F, F],
  ["fetch failed", "network", F, F, F, F, F],
  ["ffmpeg exited with code 1", "stream-failed", F, F, F, F, F],
  ["Missing Permissions", "voice-permission", F, F, F, F, F],
  ["Spotify 트랙의 YouTube 동등물을 찾을 수 없음: 곡", "no-youtube-match", F, F, F, F, F],
  ["No results found", "no-results", F, F, F, F, F],
  ["This content is not available in your country", "geo-blocked", F, F, F, F, F],
  ["무언가 알 수 없는 일", "unknown", F, F, F, F, F],
];

test("오류 분류 표: 두 집의 지금 답", () => {
  const actual = TABLE.map(([msg]) => {
    const e = new Error(msg);
    return [msg, ErrorHandler.classify(e), YouTube.isVideoUnavailableError(e), YouTube.isAgeRestrictedError(e), YouTube.isClientFault(e), YouTube.isStaleMediaError(e), YouTube.isSkippedClientError(e)];
  });
  assert.deepEqual(actual, TABLE); // 한 번에 비교해 어긋난 칸을 전부 보인다
});

test("분류는 stderr 가 있으면 그것을 본다(YouTube 쪽). classify 는 message 만 본다", () => {
  const e = Object.assign(new Error("exit 1"), { stderr: "ERROR: Video unavailable" });
  assert.equal(YouTube.isVideoUnavailableError(e), true);
  assert.equal(ErrorHandler.classify(e), "unknown");
});

test("classify 는 문자열과 빈 값도 받는다", () => {
  assert.equal(ErrorHandler.classify("fetch failed"), "network");
  assert.equal(ErrorHandler.classify(null), "unknown");
  assert.equal(ErrorHandler.classify(undefined), "unknown");
});

// 한 문장이 규칙 둘에 걸리면 표의 차례가 답을 정한다. 그런 겹침은 여기 적은 것만 있어야 한다
// (새로 겹치면 차례를 다시 보고 이 목록에 이유와 함께 더한다).
test("분류 규칙의 겹침: 알고 있는 것만", () => {
  const KNOWN = {
    "ERROR: Sign in to confirm your age. This video may be inappropriate for some users.": ["age-restricted", "bot-check"], // 연령 제한이 앞
  };
  const hits = (msg) => RULES.filter(([, tests]) => tests.some((one) => (typeof one === "function" ? one(msg.toLowerCase()) : msg.toLowerCase().includes(one)))).map(([kind]) => kind);
  const overlaps = Object.fromEntries(TABLE.map(([msg]) => [msg, hits(msg)]).filter(([, kinds]) => kinds.length > 1));
  assert.deepEqual(overlaps, KNOWN);
});

// yt-dlp 를 실행하는 곳(ytdlpSpawn)이 실패에 이름(code)을 붙인다. 이름은 위 판별 칸과 어긋나면 안 된다
test("yt-dlp 오류 이름(codeOf)은 판별 칸과 같은 뜻이다", () => {
  const expected = ([, , gone, age, fault, stale, skipped]) => (age ? "age-restricted" : gone ? "video-unavailable" : skipped ? "skipped-client" : stale ? "stale-media" : fault ? "client-fault" : null);
  for (const row of TABLE) assert.equal(YouTube.codeOf(new Error(row[0])), expected(row), row[0]);
});

test("errorKind 는 이름(code)이 있으면 글보다 먼저 본다", () => {
  const e = Object.assign(new Error("exit 1"), { code: "video-unavailable" });
  assert.equal(ErrorHandler.classify(e), "video-unavailable");
  assert.equal(ErrorHandler.classify(Object.assign(new Error("Sign in to confirm you're not a bot"), { code: "age-restricted" })), "age-restricted");
  assert.equal(ErrorHandler.classify(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })), "network", "모르는 이름이면 글로 가른다");
});
