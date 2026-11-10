// 서버에 주기적으로 조회한다(캐시 DB의 재생 테스트 확인 결과처럼 끝날 때까지 지켜보는 것). tick 이 true 를 돌려주면 일정 간격 뒤 다시 조회하고, false 면 멈춘다.
// 요청이 실패하면 멈추지 않고 간격을 두 배씩 늘려(상한 maxIntervalMs) 재시도한다. 성공하면 처음 간격으로 돌아간다.
// start 는 현재 예약과 진행 중인 요청을 취소하고 처음부터 다시 시작하며, stop 은 화면을 떠날 때 멈춘다(늦게 온 응답은 tick 의 signal 이 취소돼 반영되지 않는다)

type Timers = { set: (run: () => void, ms: number) => unknown; clear: (timer: unknown) => void };
type PollerOptions = { intervalMs: number; maxIntervalMs?: number; timers?: Timers };

const WINDOW_TIMERS: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>) };

export function createPoller(tick: (signal: AbortSignal) => Promise<boolean>, { intervalMs, maxIntervalMs = intervalMs * 16, timers = WINDOW_TIMERS }: PollerOptions) {
  let timer: unknown = null;
  let controller: AbortController | null = null;
  let delay = intervalMs;

  function schedule(ms: number) {
    timers.clear(timer);
    timer = timers.set(() => void run(), ms);
  }

  async function run() {
    const mine = (controller = new AbortController());
    let again: boolean;
    try {
      again = await tick(mine.signal);
    } catch {
      if (mine.signal.aborted) return;
      delay = Math.min(delay * 2, maxIntervalMs);
      return schedule(delay);
    }
    if (mine.signal.aborted) return;
    delay = intervalMs;
    if (again) schedule(delay);
  }

  return {
    /** 처음 간격 뒤부터 조회한다. 이미 돌고 있으면 그 예약과 진행 중인 요청을 취소한다 */
    start() {
      controller?.abort();
      delay = intervalMs;
      schedule(intervalMs);
    },
    /** 멈춘다. 예약을 취소하고 진행 중인 요청을 취소한다 */
    stop() {
      timers.clear(timer);
      timer = null;
      controller?.abort();
    },
  };
}
