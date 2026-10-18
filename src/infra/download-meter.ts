// 다운로드한 곡(캐시)의 양. 다운로드를 마칠 때 파일 크기를 더한다(다운로드 중의 조각 파일 이름은 yt-dlp 가 정해 따라 재지 않는다).
// 봇 상태 탭의 다운로드 속도는 지난 15초에 마친 양의 평균, 오늘 다운로드한 양은 이 기계의 자정부터

const WINDOW_MS = 15_000;

let done: Array<{ at: number; bytes: number }> = [];
let today = { day: "", bytes: 0 };

const dayOf = (at: number) => new Date(at).toDateString();

/** 다운로드를 마쳤다 */
function addDownloaded(bytes: number, at = Date.now()) {
  if (!(bytes > 0)) return;
  done.push({ at, bytes });
  done = done.filter((one) => at - one.at <= WINDOW_MS);
  const day = dayOf(at);
  today = today.day === day ? { day, bytes: today.bytes + bytes } : { day, bytes };
}

/** bytesPerSec: 지난 15초 평균, todayBytes: 오늘 다운로드한 양 */
function downloadMeter(now = Date.now()) {
  const recent = done.filter((one) => now - one.at <= WINDOW_MS).reduce((n, one) => n + one.bytes, 0);
  return { bytesPerSec: Math.round(recent / (WINDOW_MS / 1000)), todayBytes: today.day === dayOf(now) ? today.bytes : 0 };
}

/** 테스트: 센 것을 비운다 */
function _reset() {
  done = [];
  today = { day: "", bytes: 0 };
}

export { addDownloaded, downloadMeter, _reset };
