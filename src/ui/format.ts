// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
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

const exported = { formatDuration };
export default exported;
export { exported as "module.exports" };
