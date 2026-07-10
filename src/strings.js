"use strict";

// 여러 파일에서 공유되는 공통 한국어 문자열
// 파일별 문자열은 각 파일에 인라인으로 하드코딩
module.exports = {
  ERR_VOICE_REQUIRED: "❌ 음성 채널에 있어야 합니다!",
  ERR_NO_MUSIC: "❌ 현재 재생 중인 음악이 없습니다!",
  ERR_SAME_CHANNEL: "❌ 봇과 같은 음성 채널에 있어야 합니다!",
  ERR_NOT_AUTHORIZED: "❌ 음악 컨트롤 권한이 없습니다. (DJ 역할 필요)",
  ERR_NO_SONG_PLAYING: "❌ 현재 재생 중인 노래가 없습니다!",
  ERR_NO_PERMISSIONS: "❌ 이 음성 채널에서 말할 권한이 없습니다!",
  ERR_NO_SONGS_IN_QUEUE: "❌ 대기열에 노래가 없습니다!",
  ERR_SESSION_INVALID: "❌ 이 버튼은 더 이상 유효하지 않습니다! 음악 시스템이 재시작되었습니다.",
  ERR_PROCESSING: "❌ 처리 중 오류가 발생했습니다!",
};
