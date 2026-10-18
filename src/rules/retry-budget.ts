// 끊긴 곡을 다시 열지 넘길지. 곡마다 따로 센다.
//
// 예산은 다시 연 횟수다. 한 재생이 정상으로 60초를 가다 끊겼으면 드문 사고로 보고 예산을 다시 채운다.
// 진전(5초) 없이 연달아 두 번 끊기면 예산이 남아도 넘긴다. 다시 열어도 곧바로 죽는 곡을 붙잡지 않는다.
// 라이브는 이 규칙을 걸지 않는다. 짧은 끊김에도 엣지에 다시 붙는 데 시간이 걸리고, 다시 여는 간격을 늘려 가며 버틴다.

type RetryState = { used: number; stalled: number }; // 다시 연 횟수 · 진전 없이 연달아 끊긴 횟수
type RetryStep = { state: RetryState; reopen: boolean; why: string };

const MAX_TRACK_RETRIES = 2; // 끊긴 곡을 끊긴 위치부터 다시 여는 횟수
const MAX_LIVE_REOPENS = 5; // 라이브가 끊겼을 때 주소를 새로 받아 다시 여는 횟수
const REFILL_MS = 60_000; // 한 재생이 이만큼 가다 끊겼으면 예산을 다시 채운다
const PROGRESS_MS = 5_000; // 한 재생이 이만큼도 못 가고 끊기면 진전 없음
const STALL_LIMIT = 2; // 진전 없이 연달아 이만큼 끊기면 넘긴다

const FRESH: RetryState = { used: 0, stalled: 0 };

/**
 * 끊김 하나를 센다.
 * @param state  이 곡에서 지금까지
 * @param progressMs  끊긴 재생이 실제로 낸 길이
 * @param live  라이브를 주소 경로로 틀었다
 */
function countDrop(state: RetryState, progressMs: number, live: boolean): RetryStep {
  const base = progressMs >= REFILL_MS ? FRESH : state;
  const next = { used: base.used + 1, stalled: progressMs < PROGRESS_MS ? base.stalled + 1 : 0 };
  const limit = live ? MAX_LIVE_REOPENS : MAX_TRACK_RETRIES;
  if (next.used > limit) return { state: next, reopen: false, why: `재시도 ${limit}회 소진` };
  if (!live && next.stalled >= STALL_LIMIT) return { state: next, reopen: false, why: `${PROGRESS_MS / 1000}초도 못 가고 ${next.stalled}번 연달아 끊김` };
  return { state: next, reopen: true, why: "" };
}

export { countDrop, FRESH, MAX_TRACK_RETRIES, MAX_LIVE_REOPENS, PROGRESS_MS };
export type { RetryState };
