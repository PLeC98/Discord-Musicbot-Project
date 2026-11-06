// 캐시 DB 의 정규식 필터를 따로 도는 스레드(regex-filter-worker)에서 맞춘다. 정규식은 무늬에 따라 백트래킹이 끝없이 늘 수 있어
// (겹친 반복을 막아도 (\w+\s?)+$ 같은 평범한 무늬가 빠져나간다) 음악 재생과 같은 이벤트 루프에서 돌리지 않는다.
// 스레드는 처음 맞출 때 띄우고 계속 쓴다. 맞추기는 하나씩 보내고 상한은 그 맞추기가 시작된 때부터 잰다(앞의 것을 기다린 시간은 넣지 않는다).
// 상한을 넘기면 스레드를 끝내고(돌던 정규식이 멈춘다) 그 맞추기만 시간 초과로 돌린다. 기다리던 것은 새 스레드에서 이어 맞춘다

import { Worker } from "worker_threads";

/** 맞추기 한 번의 상한 */
const MATCH_TIMEOUT_MS = 1000;

/** 맞추기의 결과. hits: 맞은 행의 번호, timeout: 상한을 넘겼다, aborted: 부른 쪽이 기다리다 버렸다(돌기 전에 줄에서 뺐다). 스레드가 실패하면 거절(reject) */
type MatchResult = { kind: "hits"; hits: number[] } | { kind: "timeout" } | { kind: "aborted" };
type Job = { id: number; sources: string[]; rows: Array<Array<string | null>>; timeoutMs: number; resolve: (result: MatchResult) => void; reject: (error: Error) => void };
let thread: Worker | null = null;
const queue: Job[] = [];
let running: { job: Job; timer: NodeJS.Timeout } | null = null;
let lastId = 0;

function spawn() {
  const one = new Worker(new URL("./regex-filter-worker.ts", import.meta.url));
  one.on("message", ({ id, hits, error }: { id: number; hits?: number[]; error?: string }) => {
    if (thread !== one || running?.job.id !== id) return;
    const { job } = finish();
    if (hits) job.resolve({ kind: "hits", hits });
    else job.reject(new Error(error || "정규식을 맞추지 못했습니다"));
    next();
  });
  one.on("error", (error) => stop(one, error));
  one.on("exit", () => stop(one, new Error("정규식 스레드가 끝났습니다")));
  one.unref(); // 봇이 끝날 때 붙잡지 않는다
  return one;
}

// 돌던 맞추기를 비우고 돌려준다
function finish() {
  const done = running!;
  clearTimeout(done.timer);
  running = null;
  return done;
}

// 기다리는 맞추기가 있으면 하나 보낸다
function next() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  const worker = (thread ??= spawn());
  running = { job, timer: setTimeout(() => stop(worker, null), job.timeoutMs) };
  worker.postMessage({ id: job.id, sources: job.sources, rows: job.rows });
}

// 스레드를 끝낸다. 돌던 맞추기는 상한을 넘겼으면 null(시간 초과), 그 밖의 끝남은 실패. 기다리던 것은 새 스레드에서
function stop(one: Worker, error: Error | null) {
  if (thread !== one) return;
  thread = null;
  void one.terminate();
  if (running) {
    const { job } = finish();
    if (error) job.reject(error);
    else job.resolve({ kind: "timeout" });
  }
  next();
}

/**
 * 행마다 sources 차례의 값(rows)이 모든 정규식(대소문자 무시)에 맞는 행의 번호. 빈 값은 맞지 않는다.
 * signal 이 끊으면 줄에서 기다리던 것은 빼고 aborted 로 끝낸다(화면이 버린 요청이 뒤의 것을 붙잡지 않게). 돌기 시작한 것은 상한 안에 끝나니 그대로 둔다
 */
function matchRegexes(sources: string[], rows: Array<Array<string | null>>, { timeoutMs = MATCH_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<MatchResult> {
  if (signal?.aborted) return Promise.resolve({ kind: "aborted" });
  return new Promise((resolve, reject) => {
    const job: Job = { id: ++lastId, sources, rows, timeoutMs, resolve, reject };
    queue.push(job);
    signal?.addEventListener(
      "abort",
      () => {
        const at = queue.indexOf(job);
        if (at < 0) return;
        queue.splice(at, 1);
        resolve({ kind: "aborted" });
      },
      { once: true },
    );
    next();
  });
}

export { matchRegexes, MATCH_TIMEOUT_MS };
export type { MatchResult };
