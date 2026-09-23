const log = require("../infra/log/logger").child({ category: "error" });
const { errorKind } = require("../rules/errorKind");
const ERROR_MESSAGES = {
  "bot-check": "❌ **YouTube가 이 요청을 차단했습니다 (봇 감지)**\nYouTube가 이 서버의 IP 주소에서 오는 요청을 거부하고 있습니다.\n\n**해결 방법:** bgutil-ytdlp-pot-provider를 설치하거나, `.env` 파일에 `COOKIES_SOURCE=chrome` (또는 firefox/edge)를 추가하세요.",
  // 운영자가 쿠키를 일부러 안 걸어 둔 것일 수 있다. 사용자에게 설정 방법을 늘어놓지 않는다
  "age-restricted": "❌ 연령 제한 영상은 재생할 수 없어요.",
  "video-unavailable": "❌ 비공개이거나 삭제된 영상은 재생할 수 없어요.",
  "geo-blocked": "❌ **지역 차단 콘텐츠**\n이 동영상은 봇이 호스팅된 지역에서 제한되어 있습니다.\n\n**해결 방법:** 다른 링크를 시도해 보세요.",
  "rate-limited": "❌ **요청이 너무 많습니다 (속도 제한)**\nYouTube 또는 다른 플랫폼이 일시적으로 요청을 차단하고 있습니다.\n\n**해결 방법:** 몇 분 기다렸다가 다시 시도하세요. 자주 발생하면 `.env`에 `COOKIES_SOURCE`를 추가하세요.",
  "no-youtube-match": "❌ **Spotify 트랙을 YouTube에서 찾을 수 없습니다**\n이 곡에 대한 일치하는 YouTube 동영상을 찾을 수 없었습니다.\n\n**해결 방법:** Spotify 링크 대신 곡 이름으로 직접 검색하거나 YouTube 링크를 붙여넣으세요.",
  "no-results": "❌ **결과 없음**\n검색과 일치하는 곡을 찾을 수 없었습니다.\n\n**해결 방법:** 다른 검색어를 사용하거나 직접 URL을 붙여넣으세요.",
  network: "❌ **네트워크 오류**\n봇이 음악 플랫폼에 연결할 수 없었습니다. 보통 일시적인 문제입니다.\n\n**해결 방법:** 잠시 기다렸다가 다시 시도하세요.",
  "stream-failed": "❌ **오디오 스트림 실패**\n봇이 트랙을 찾았지만 오디오 스트림을 시작할 수 없었습니다.\n\n**해결 방법:** 다시 시도하거나 다른 버전의 곡을 시도해 보세요.",
  "voice-permission": "❌ **음성 채널 권한 없음**\n봇이 음성 채널에 참여하거나 말할 권한이 없습니다.\n\n**해결 방법:** 음성 채널 설정 → 권한 → 봇에게 **연결** 및 **말하기** 권한을 부여하세요.",
  unknown: "❌ **예상치 못한 오류가 발생했습니다**\n요청을 처리하는 중 문제가 발생했습니다.\n\n**해결 방법:** 잠시 후 다시 시도하세요. 문제가 계속되면 봇 콘솔 로그를 확인하세요.",
};

/**
 * 원시 오류를 알려진 범주로 분류하고 수정 제안을 포함한 한국어 메시지를 반환
 *
 * 사용 예:
 *   const msg = await ErrorHandler.getMessage(error);
 *   await interaction.editReply({ content: msg });
 */
// play() 가 곡을 못 틀었을 때(code). 오류로 못 튼 것은 오류 종류로 안내한다
const PLAY_FAILURE = {
  "queue-empty": "대기열에 트랙이 없습니다!",
  "voice-failed": "음성 채널에 연결하지 못했습니다!",
};

class ErrorHandler {
  // 종류는 rules/errorKind 가 가른다
  static classify(error) {
    return errorKind(error);
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
   * @param {string} context. 예: 'play.js search', 'MusicPlayer.play'
   * @returns {string}
   */
  /** play() 의 실패 결과({ ok: false, code, error })를 사용자 문장으로 */
  static playFailure(result) {
    return PLAY_FAILURE[result?.code] ?? (result?.error ? this.getMessage(result.error) : "재생을 시작할 수 없습니다.");
  }

  static handle(error, context = "") {
    const category = this.classify(error);
    // context → sub(하위 카테고리), 분류 결과 → kind(구조화 필드, 터미널 배지엔 안 뜸)
    log.error({ sub: context || undefined, kind: category }, `${error?.message || error}`);
    return this.getMessage(error);
  }
}

module.exports = ErrorHandler;
