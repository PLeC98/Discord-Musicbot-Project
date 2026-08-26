const log = require("./logger").child({ category: "error" });
const ERROR_MESSAGES = {
  youtube_bot_detection: "❌ **YouTube가 이 요청을 차단했습니다 (봇 감지)**\nYouTube가 이 서버의 IP 주소에서 오는 요청을 거부하고 있습니다.\n\n**해결 방법:** bgutil-ytdlp-pot-provider를 설치하거나, `.env` 파일에 `COOKIES_FROM_BROWSER=chrome` (또는 firefox/edge)를 추가하세요.",
  youtube_age_restricted: "❌ **연령 제한 동영상**\n이 동영상은 YouTube 계정 로그인이 필요합니다.\n\n**해결 방법:** `.env`에 `COOKIES_FROM_BROWSER=chrome`을 설정하여 봇이 브라우저의 YouTube 세션을 사용할 수 있도록 하세요.",
  youtube_unavailable: "❌ **동영상을 사용할 수 없습니다**\n이 동영상은 비공개이거나, 삭제되었거나, 이 지역에서 이용할 수 없습니다. 다른 링크나 곡을 시도해 보세요.",
  youtube_geo_blocked: "❌ **지역 차단 콘텐츠**\n이 동영상은 봇이 호스팅된 지역에서 제한되어 있습니다.\n\n**해결 방법:** 다른 링크를 시도해 보세요.",
  rate_limited: "❌ **요청이 너무 많습니다 (속도 제한)**\nYouTube 또는 다른 플랫폼이 일시적으로 요청을 차단하고 있습니다.\n\n**해결 방법:** 몇 분 기다렸다가 다시 시도하세요. 자주 발생하면 `.env`에 `COOKIES_FROM_BROWSER`를 추가하세요.",
  spotify_no_match: "❌ **Spotify 트랙을 YouTube에서 찾을 수 없습니다**\n이 곡에 대한 일치하는 YouTube 동영상을 찾을 수 없었습니다.\n\n**해결 방법:** Spotify 링크 대신 곡 이름으로 직접 검색하거나 YouTube 링크를 붙여넣으세요.",
  no_results: "❌ **결과 없음**\n검색과 일치하는 곡을 찾을 수 없었습니다.\n\n**해결 방법:** 다른 검색어를 사용하거나 직접 URL을 붙여넣으세요.",
  network_error: "❌ **네트워크 오류**\n봇이 음악 플랫폼에 연결할 수 없었습니다. 보통 일시적인 문제입니다.\n\n**해결 방법:** 잠시 기다렸다가 다시 시도하세요.",
  stream_failed: "❌ **오디오 스트림 실패**\n봇이 트랙을 찾았지만 오디오 스트림을 시작할 수 없었습니다.\n\n**해결 방법:** 다시 시도하거나 다른 버전의 곡을 시도해 보세요.",
  voice_no_permission: "❌ **음성 채널 권한 없음**\n봇이 음성 채널에 참여하거나 말할 권한이 없습니다.\n\n**해결 방법:** 음성 채널 설정 → 권한 → 봇에게 **연결** 및 **말하기** 권한을 부여하세요.",
  unknown: "❌ **예상치 못한 오류가 발생했습니다**\n요청을 처리하는 중 문제가 발생했습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 문제가 계속되면 봇 콘솔 로그를 확인하세요.",
};

/**
 * 원시 오류를 알려진 범주로 분류하고 수정 제안을 포함한 한국어 메시지를 반환
 *
 * 사용 예:
 *   const msg = await ErrorHandler.getMessage(error);
 *   await interaction.editReply({ content: msg });
 */
class ErrorHandler {
  /**
   * Error 객체 또는 문자열에서 오류 범주를 감지
   * @param {Error|string} error
   * @returns {string} 범주 키
   */
  static classify(error) {
    const msg = (error instanceof Error ? error.message : String(error || "")).toLowerCase();

    // YouTube 봇 감지 / 로그인 필요
    if (msg.includes("sign in to confirm") || msg.includes("confirm you") || msg.includes("bot detection") || msg.includes("not a robot") || msg.includes("please sign in") || msg.includes("inappropriate") || msg.includes("this video is unavailable") || (msg.includes("youtube") && msg.includes("403"))) return "youtube_bot_detection";

    // 연령 제한
    if (msg.includes("age-restricted") || msg.includes("age restricted") || msg.includes("confirm your age") || msg.includes("only available to registered users")) return "youtube_age_restricted";

    // 비공개 / 삭제됨 / 사용할 수 없는 영상
    if (msg.includes("private video") || msg.includes("video unavailable") || msg.includes("this video has been removed") || msg.includes("no longer available") || msg.includes("has been deleted") || msg.includes("video is not available")) return "youtube_unavailable";

    // 지역 제한
    if (msg.includes("not available in your country") || msg.includes("geo") || msg.includes("blocked in") || msg.includes("region")) return "youtube_geo_blocked";

    // 속도 제한
    if (msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("quota")) return "rate_limited";

    // Spotify 트랙을 YouTube에서 찾을 수 없음
    if (msg.includes("youtube equivalent not found") || msg.includes("no youtube match") || msg.includes("could not find youtube")) return "spotify_no_match";

    // 결과 없음
    if (msg.includes("no results") || msg.includes("not found") || msg.includes("no entries") || msg.includes("no tracks")) return "no_results";

    // 네트워크 / 연결 오류
    if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout") || msg.includes("fetch failed") || msg.includes("socket hang up") || msg.includes("network") || msg.includes("connection refused") || msg.includes("getaddrinfo")) return "network_error";

    // FFmpeg / 스트림 처리
    if (msg.includes("ffmpeg") || msg.includes("pipe") || msg.includes("stream") || msg.includes("audio") || msg.includes("codec")) return "stream_failed";

    // 음성 채널 권한
    if (msg.includes("missing access") || msg.includes("missing permissions") || msg.includes("voice_join") || msg.includes("speak")) return "voice_no_permission";

    return "unknown";
  }

  /**
   * 수정 지침을 포함한 사용자 표시용 한국어 오류 메시지를 반환
   * @param {Error|string} error
   * @returns {string}
   */
  static getMessage(error) {
    const category = this.classify(error);
    return ERROR_MESSAGES[category] || ERROR_MESSAGES.unknown;
  }

  /**
   * 실제 오류를 전체 상세 정보와 함께 콘솔에 기록한 뒤 사용자 표시용 메시지를 반환
   * catch 블록에서 바로 사용할 수 있음
   * @param {Error|string} error
   * @param {string|null} _guildId  — API 호환성을 위해 유지, 미사용
   * @param {string} context  — 예: 'play.js search', 'MusicPlayer.play'
   * @returns {string}
   */
  static handle(error, _guildId = null, context = "") {
    const category = this.classify(error);
    // context → sub(하위 카테고리), 분류 결과 → kind(구조화 필드, 터미널 배지엔 안 뜸)
    log.error({ sub: context || undefined, kind: category }, `❌ ${error?.message || error}`);
    return this.getMessage(error);
  }
}

module.exports = ErrorHandler;
