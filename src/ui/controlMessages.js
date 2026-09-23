// 재생 조작(usecases/controls)이 거절한 까닭(code)을 사람이 읽을 문장으로. 디스코드는 문장 그대로,
// 대시보드는 ❌ 를 뗀 문장과 HTTP 상태 코드로 쓴다. 권한 거절은 권한 판정이 만든 안내(message)를 쓴다.

import S from "./strings.js";

// 1:05 · 1:02:05
function formatMs(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const TEXT = {
  "no-player": () => S.ERR_NO_MUSIC,
  "no-track": () => S.ERR_NO_SONG_PLAYING,
  failed: () => "❌ 작업이 실패했습니다!",
  "skip-failed": () => "❌ 노래가 건너뛰어지지 않았습니다!",
  "previous-failed": () => "❌ 이전 노래로 이동하지 못했습니다!",
  "jump-failed": () => "❌ 곡으로 이동하지 못했습니다!",
  "nothing-to-skip": () => "❌ 건너뛸 노래가 없습니다! 대기열에 노래가 없습니다.",
  "no-previous": () => "❌ 이전 노래가 없습니다!",
  "live-no-seek": () => S.ERR_LIVE_NO_SEEK,
  starting: () => "❌ 재생을 준비 중입니다. 잠시 후 다시 시도해 주세요.",
  "beyond-end": ({ durationMs }) => `❌ 입력한 시간이 곡 길이를 초과합니다. (최대: ${formatMs(durationMs)})`,
  "no-highlight": () => "❌ 이 곡에는 SponsorBlock 하이라이트 지점이 없어요.",
  "bad-volume": () => "❌ 볼륨은 0에서 100 사이의 숫자여야 합니다!",
  "bad-loop-mode": () => "❌ 반복 모드가 올바르지 않습니다.",
  "live-no-loop": () => S.ERR_LIVE_NO_LOOP,
  "too-few-to-shuffle": () => "❌ 셔플하려면 대기열에 최소 2개의 노래가 있어야 합니다!",
  "too-few-to-move": () => "❌ 순서를 변경하려면 대기열에 2곡 이상 있어야 합니다.",
  "queue-empty": () => S.ERR_NO_SONGS_IN_QUEUE,
  "bad-position": ({ size }) => `❌ 대기열에 ${size}개의 곡만 있습니다. (1 ~ ${size} 범위로 입력하세요)`,
  "same-position": () => "❌ 현재 위치와 이동할 위치가 같습니다.",
};

// 대시보드의 HTTP 상태. 입력이 틀린 것은 400, 권한은 403, 지금 상태로는 못 하는 것은 409
const STATUS = { "no-permission": 403, "beyond-end": 400, "bad-volume": 400, "bad-loop-mode": 400, "bad-position": 400, "same-position": 400 };

/** 거절 결과({ ok: false, code, message? })를 디스코드에 보일 문장으로 */
function controlMessage(result) {
  if (result.code === "no-permission") return result.message;
  return TEXT[result.code]?.(result) ?? "❌ 작업이 실패했습니다!";
}

/** 거절 결과를 대시보드 응답으로 { status, error } */
function controlApiError(result) {
  return { status: STATUS[result.code] ?? 409, error: S.withoutErrorMark(controlMessage(result)) };
}

const exported = { controlMessage, controlApiError };
export default exported;
export { exported as "module.exports" };
