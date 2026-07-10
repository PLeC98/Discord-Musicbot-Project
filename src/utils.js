"use strict";

// 프로젝트 공용 소형 유틸

/** 초 단위 길이를 H:MM:SS 또는 M:SS 문자열로 변환 */
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return "0:00";

  // 부동소수점 오류를 피하도록 정수로 처리
  const totalSeconds = Math.floor(Number(seconds) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

module.exports = { formatDuration };
