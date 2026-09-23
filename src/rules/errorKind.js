"use strict";

// 판정: 이 오류는 어떤 종류인가. 오류 문장을 보고 종류 이름을 낸다. 문장은 ui/errorMessages 가 만든다.
// 규칙은 위에서부터 처음 맞는 것이 이긴다. 차례가 곧 우선순위다.

function errorKind(error) {
  const msg = (error instanceof Error ? error.message : String(error || "")).toLowerCase();

  // YouTube 봇 감지 / 로그인 필요
  if (msg.includes("sign in to confirm") || msg.includes("confirm you") || msg.includes("bot detection") || msg.includes("not a robot") || msg.includes("please sign in") || msg.includes("inappropriate") || msg.includes("this video is unavailable") || (msg.includes("youtube") && msg.includes("403"))) return "bot-check";

  // 연령 제한
  if (msg.includes("age-restricted") || msg.includes("age restricted") || msg.includes("confirm your age") || msg.includes("only available to registered users")) return "age-restricted";

  // 비공개 / 삭제됨 / 사용할 수 없는 영상
  if (msg.includes("private video") || msg.includes("video unavailable") || msg.includes("this video has been removed") || msg.includes("no longer available") || msg.includes("has been deleted") || msg.includes("video is not available")) return "video-unavailable";

  // 지역 제한
  if (msg.includes("not available in your country") || msg.includes("geo") || msg.includes("blocked in") || msg.includes("region")) return "geo-blocked";

  // 속도 제한
  if (msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("quota")) return "rate-limited";

  // Spotify 트랙을 YouTube에서 찾을 수 없음
  if (msg.includes("youtube equivalent not found") || msg.includes("no youtube match") || msg.includes("could not find youtube") || msg.includes("동등물")) return "no-youtube-match";

  // 결과 없음
  if (msg.includes("no results") || msg.includes("not found") || msg.includes("no entries") || msg.includes("no tracks")) return "no-results";

  // 네트워크 / 연결 오류
  if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout") || msg.includes("fetch failed") || msg.includes("socket hang up") || msg.includes("network") || msg.includes("connection refused") || msg.includes("getaddrinfo")) return "network";

  // FFmpeg / 스트림 처리
  if (msg.includes("ffmpeg") || msg.includes("pipe") || msg.includes("stream") || msg.includes("audio") || msg.includes("codec")) return "stream-failed";

  // 음성 채널 권한
  if (msg.includes("missing access") || msg.includes("missing permissions") || msg.includes("voice_join") || msg.includes("speak")) return "voice-permission";

  return "unknown";
}

module.exports = { errorKind };
