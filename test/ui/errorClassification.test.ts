// yt-dlp 문장을 가르는 두 쓰임을 한 표로 본다.
//
// yt-dlp 를 실행하는 곳(ytdlpSpawn)이 실패에 이름을 붙이고(YouTube.codeOf), 사용자에게 보일 종류(classify)는 그 이름으로 정해진다.
// 재시도 · 폴백(YouTube.is*Error)은 같은 문장을 따로 가른다. 두 쓰임이 같은 문장을 같은 뜻으로 가르는지 이 표가 본다.
// "고친 순서" 라고 적은 행은 예전에 봇 감지로 잘못 가르던 것이다.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as YouTube from "../../src/sources/youtube/index.ts";
import { errorKind, codedError } from "../../src/rules/errorKind.ts";
import { ytDlpError } from "../helpers/errors.ts";
// [문장, classify, 영상없음, 연령제한, 클라이언트탓, 주소어긋남, 클라이언트건너뜀]
const T = true;
const F = false;
// 문장, 분류, 판별 칸(내려감 · 연령 제한 · 클라이언트 탓 · 낡은 주소 · 건너뛴 클라이언트)
type Row = [msg: string, kind: string, gone: boolean, age: boolean, fault: boolean, stale: boolean, skipped: boolean];
const TABLE: Row[] = [
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
  ["WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.\nERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.", "age-cookies-invalid", F, T, F, F, F], // 쿠키로 다시 시도했는데 쿠키가 무효. 원인은 WARNING 에만 있다. 연령 제한 판별은 그대로 참(재시도 흐름)
  // 클라이언트 · 포맷
  ["ERROR: Requested format is not available", "unknown", F, F, T, F, F],
  ["ERROR: Only images are available for download", "unknown", F, F, T, F, F],
  ["WARNING: web client https formats require a PO Token which was not provided", "unknown", F, F, T, F, F],
  ['WARNING: Skipping client "android" since it does not support cookies\nERROR: Requested format is not available', "unknown", F, F, F, F, T],
  ["ERROR: nsig extraction failed: Some formats may be missing", "unknown", F, F, T, F, F],
  // 미디어 주소 어긋남
  ["ERROR: unable to download video data: HTTP Error 403: Forbidden", "unknown", F, F, T, T, F], // 403 은 봇 감지가 아니다
  ["ERROR: unable to download fragment 12", "unknown", F, F, T, T, F],
  ["HTTP Error 429: Too Many Requests", "rate-limited", F, F, T, T, F],
  // 그 밖
  ["getaddrinfo ENOTFOUND youtube.com", "network", F, F, F, F, F],
  ["ffmpeg exited with code 1", "stream-failed", F, F, F, F, F],
  ["This content is not available in your country", "geo-blocked", F, F, F, F, F],
  ["무언가 알 수 없는 일", "unknown", F, F, F, F, F],
];

// ytdlpSpawn 이 내는 모양: 글은 그대로, 이름은 codeOf
const shaped = ytDlpError;

test("오류 분류 표: yt-dlp 가 단 이름으로 가른 종류와 판별 칸", () => {
  const actual = TABLE.map(([msg]) => {
    const e = new Error(msg);
    return [msg, errorKind(shaped(msg)), YouTube.isVideoUnavailableError(e), YouTube.isAgeRestrictedError(e), YouTube.isClientFault(e), YouTube.isStaleMediaError(e), YouTube.isSkippedClientError(e)];
  });
  assert.deepEqual(actual, TABLE); // 한 번에 비교해 어긋난 칸을 전부 보인다
});

test("분류는 stderr 가 있으면 그것을 본다(YouTube 쪽). classify 는 message 만 본다", () => {
  const e = Object.assign(new Error("exit 1"), { stderr: "ERROR: Video unavailable" });
  assert.equal(YouTube.isVideoUnavailableError(e), true);
  assert.equal(errorKind(e), "unknown");
});

// 글은 보지 않는다. 이름을 달지 않은 오류는 무엇이라 적혀 있든 unknown 이다(예전에는 낱말로 갈라 프로그램 버그가 엉뚱한 종류가 됐다)
test("classify 는 이름이 없으면 unknown. 문자열과 빈 값도 받는다", () => {
  for (const msg of ["fetch failed", "Missing Permissions", "Cannot read properties of undefined (reading 'geometry')", "Invalid regional indicator", "player.stream is not a function", "Could not find YouTube equivalent"]) {
    assert.equal(errorKind(new Error(msg)), "unknown", msg);
  }
  assert.equal(errorKind("ERROR: Video unavailable"), "unknown");
  assert.equal(errorKind(null), "unknown");
  assert.equal(errorKind(undefined), "unknown");
});

// yt-dlp 를 실행하는 곳(ytdlpSpawn)이 실패에 이름(code)을 붙인다. 판별 칸과 같은 뜻이고, 사용자에게 알릴 종류(봇 감지 · 지역 차단 ·
// 요청 제한 · 네트워크 · ffmpeg)도 여기서 붙는다. yt-dlp 가 쓰지 않는 문장(우리 코드 · 프로그램 버그)에는 이름이 없다
test("yt-dlp 오류 이름(codeOf): 문장마다", () => {
  const CODES: Record<string, string | null> = {
    "ERROR: [youtube] abc: Video unavailable": "video-unavailable",
    "ERROR: [youtube] abc: This video is unavailable": "video-unavailable",
    "ERROR: [youtube] abc: Private video. Sign in if you've been granted access": "video-unavailable",
    "ERROR: This video has been removed by the uploader": "video-unavailable",
    "ERROR: This video is no longer available because the YouTube account associated with this video has been terminated": "video-unavailable",
    "ERROR: Sign in to confirm your age. This video may be inappropriate for some users.": "age-restricted",
    "ERROR: Sign in to confirm you're not a bot": "bot-check",
    "WARNING: The provided YouTube account cookies are no longer valid": null,
    "WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.\nERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.": "age-cookies-invalid",
    "ERROR: Requested format is not available": "client-fault",
    "ERROR: Only images are available for download": "client-fault",
    "WARNING: web client https formats require a PO Token which was not provided": "client-fault",
    'WARNING: Skipping client "android" since it does not support cookies\nERROR: Requested format is not available': "skipped-client",
    "ERROR: nsig extraction failed: Some formats may be missing": "client-fault",
    "ERROR: unable to download video data: HTTP Error 403: Forbidden": "stale-media",
    "ERROR: unable to download fragment 12": "stale-media",
    "HTTP Error 429: Too Many Requests": "rate-limited", // 요청 제한이 주소 어긋남보다 앞이다. 다시 받을지는 isStaleMediaError 가 따로 본다
    "getaddrinfo ENOTFOUND youtube.com": "network",
    "ffmpeg exited with code 1": "stream-failed",
    "This content is not available in your country": "geo-blocked",
    "무언가 알 수 없는 일": null,
  };
  assert.deepEqual(
    Object.keys(CODES),
    TABLE.map(([msg]) => msg),
    "위 표의 문장 차례 그대로",
  );
  assert.deepEqual(
    TABLE.map(([msg]) => [msg, YouTube.codeOf(new Error(msg))]),
    Object.entries(CODES),
  );
  // 영상 ID 에 429 가 들어도 요청 제한이 아니다. 줄마다 [youtube] 가 붙어도 403 이 봇 감지가 아니다
  assert.equal(YouTube.codeOf(new Error("ERROR: [youtube] ab429cdefgh: Video unavailable")), "video-unavailable");
  assert.equal(YouTube.codeOf(new Error("ERROR: [youtube] ab429cdefgh: Requested format is not available")), "client-fault");
  assert.equal(YouTube.codeOf(new Error("ERROR: [youtube] abc: unable to download video data: HTTP Error 403: Forbidden")), "stale-media");
});

// 2026-09-26 실측: 닿을 수 없는 프록시로 yt-dlp 를 돌렸을 때의 줄
test("yt-dlp 가 쓰는 연결 실패 문장은 네트워크다", () => {
  for (const stderr of ["WARNING: [youtube:search] ('Unable to connect to proxy', NewConnectionError(\"HTTPSConnection(host='127.0.0.1', port=9): Failed to establish a new connection: [WinError 10061] …\")). Retrying (1/3)...", "ERROR: [youtube] abc: Unable to download API page: HTTPSConnection(host='www.youtube.com', port=443): Failed to establish a new connection: [Errno 111] Connection refused", "ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>"]) {
    assert.equal(YouTube.codeOf(new Error(stderr)), "network", stderr);
  }
});

test("yt-dlp 가 쓰는 재생목록 · 지역 차단 문장", () => {
  assert.equal(YouTube.codeOf(new Error("ERROR: [youtube:tab] PLzzz: The playlist does not exist.")), "playlist-unavailable");
  assert.equal(YouTube.codeOf(new Error("ERROR: [youtube:tab] PLzzz: This playlist is private")), "playlist-unavailable");
  assert.equal(YouTube.codeOf(new Error("ERROR: [youtube] abc: The uploader has not made this video available in your country")), "geo-blocked");
  assert.equal(YouTube.codeOf(new Error("ERROR: [soundcloud] 123: This video is not available from your location due to geo restriction")), "geo-blocked");
});

test("errorKind 는 이름(code)이 있으면 글보다 먼저 본다", () => {
  const e = Object.assign(new Error("exit 1"), { code: "video-unavailable" });
  assert.equal(errorKind(e), "video-unavailable");
  assert.equal(errorKind(Object.assign(new Error("Sign in to confirm you're not a bot"), { code: "age-restricted" })), "age-restricted");
  assert.equal(errorKind(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })), "network", "모르는 이름이면 글로 가른다");
});

test("errorKind 는 오류 자신 → 원인(cause) → 시스템 · 디스코드 번호 차례로 이름을 본다", () => {
  // 글에 기대지 않는다: 글만 보면 unknown 인 것들
  const quiet = (code: string | number) => Object.assign(new Error("무언가"), { code });
  assert.equal(errorKind(codedError("stream-failed", "무언가")), "stream-failed");
  assert.equal(errorKind(new Error("무언가", { cause: quiet("ENOTFOUND") })), "network", "fetch 는 원인에 시스템 이름을 단다");
  assert.equal(errorKind(quiet("UND_ERR_CONNECT_TIMEOUT")), "network");
  // 감싼 오류의 원인의 원인(fetch 오류는 원인에 시스템 이름이 붙는다)
  assert.equal(errorKind(new Error("익명 상태를 얻지 못했습니다", { cause: new TypeError("fetch failed", { cause: quiet("ECONNREFUSED") }) })), "network");
  assert.equal(errorKind(Object.assign(new Error("무언가"), { name: "TimeoutError" })), "network", "AbortSignal.timeout");
  assert.equal(errorKind(Object.assign(new Error("무언가"), { name: "AbortError" })), "unknown", "음성 연결 기다림이 끝난 것은 네트워크가 아니다");
  assert.equal(errorKind(quiet(50013)), "voice-permission");
  assert.equal(errorKind(quiet("skipped-client")), "unknown", "종류가 아닌 이름(다시 시도용)은 종류가 되지 않는다");
});
