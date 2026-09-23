"use strict";

// 판정: 이 오류는 어떤 종류인가. 오류 문장을 보고 종류 이름을 낸다. 문장은 ui/errorMessages 가 만든다.
// 오류에 이름(code)이 붙어 있으면 그것을 먼저 본다. 없으면 표의 위에서부터 처음 맞는 것이 이긴다. 차례가 곧 우선순위다.
//
// 연령 제한이 봇 감지보다 앞이다. 연령 확인 문장("Sign in to confirm your age")이 봇 감지의 "sign in to confirm" 도
// 품고 있어서, 차례가 거꾸로면 연령 제한이 봇 감지로 가려진다.

const RULES = [
  ["age-restricted", ["age-restricted", "age restricted", "confirm your age", "only available to registered users"]],
  // YouTube 봇 감지 / 로그인 필요
  ["bot-check", ["sign in to confirm", "confirm you", "bot detection", "not a robot", "please sign in", "inappropriate", (m) => m.includes("youtube") && m.includes("403")]],
  // 비공개 / 삭제됨 / 사용할 수 없는 영상
  ["video-unavailable", ["private video", "video unavailable", "this video is unavailable", "this video has been removed", "no longer available", "has been deleted", "video is not available"]],
  ["geo-blocked", ["not available in your country", "geo", "blocked in", "region"]],
  ["rate-limited", ["429", "too many requests", "rate limit", "quota"]],
  // Spotify 트랙을 YouTube 에서 찾을 수 없음
  ["no-youtube-match", ["youtube equivalent not found", "no youtube match", "could not find youtube", "동등물"]],
  ["no-results", ["no results", "not found", "no entries", "no tracks"]],
  ["network", ["econnreset", "econnrefused", "etimedout", "fetch failed", "socket hang up", "network", "connection refused", "getaddrinfo"]],
  // FFmpeg / 스트림 처리
  ["stream-failed", ["ffmpeg", "pipe", "stream", "audio", "codec"]],
  ["voice-permission", ["missing access", "missing permissions", "voice_join", "speak"]],
];

// 오류를 만든 곳이 이름을 붙여 두었으면(code) 글보다 그것을 먼저 믿는다
const CODE_KINDS = { "age-restricted": "age-restricted", "video-unavailable": "video-unavailable" };

const matches = (msg, test) => (typeof test === "function" ? test(msg) : msg.includes(test));

function errorKind(error) {
  if (error && CODE_KINDS[error.code]) return CODE_KINDS[error.code];
  const msg = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  for (const [kind, tests] of RULES) if (tests.some((test) => matches(msg, test))) return kind;
  return "unknown";
}

module.exports = { errorKind, RULES };
