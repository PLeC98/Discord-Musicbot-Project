"use strict";

// 여러 파일에서 공유되는 공통 한국어 문자열
// 파일별 문자열은 각 파일에 인라인으로 하드코딩

// 오류 문자열의 ❌ 접두 규약. 출처(strings/ErrorHandler/TrackResolver)마다 접두 유무가 달라
// 표시 지점에서 반드시 정규화한다 — 디스코드는 정확히 하나, 대시보드 JSON은 없음.
const withErrorMark = (msg) => {
  const text = String(msg ?? "");
  return text.trimStart().startsWith("❌") ? text : `❌ ${text}`;
};
const withoutErrorMark = (msg) => String(msg ?? "").replace(/^\s*❌\s*/, "");

// 여러 곡을 한 번에 담은 출처의 표시 이름 (TrackResolver의 collection 값). 모르면 재생목록
const COLLECTION_LABELS = { playlist: "재생목록", album: "앨범", artist: "아티스트 인기곡" };
const collectionLabel = (collection) => COLLECTION_LABELS[collection] || COLLECTION_LABELS.playlist;

module.exports = {
  withErrorMark,
  withoutErrorMark,
  collectionLabel,

  ERR_VOICE_REQUIRED: "❌ 음성 채널에 있어야 합니다!",
  ERR_NO_MUSIC: "❌ 현재 재생 중인 음악이 없습니다!",
  ERR_SAME_CHANNEL: "❌ 봇과 같은 음성 채널에 있어야 합니다!",
  ERR_NOT_AUTHORIZED: "❌ 음악 컨트롤 권한이 없습니다. (DJ 역할 필요)",
  ERR_NO_SONG_PLAYING: "❌ 현재 재생 중인 노래가 없습니다!",
  ERR_NO_PERMISSIONS: "❌ 이 음성 채널에서 말할 권한이 없습니다!",
  ERR_NO_SONGS_IN_QUEUE: "❌ 대기열에 노래가 없습니다!",
  ERR_SESSION_INVALID: "❌ 이 버튼은 더 이상 유효하지 않습니다! 음악 시스템이 재시작되었습니다.",
  ERR_PROCESSING: "❌ 처리 중 오류가 발생했습니다!",
  ERR_LIVE_NOT_SUPPORTED: "❌ 라이브 방송은 재생할 수 없어요. 다시보기(VOD)나 일반 영상 링크를 넣어 주세요!",
};
