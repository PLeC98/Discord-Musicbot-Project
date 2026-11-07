// 캐시 DB의 정규식 필터를 별도 워커 스레드(regex-filter-worker)에서 검사한다. 정규식은 패턴에 따라 백트래킹이 끝없이 늘어날 수 있어
// (중첩 반복을 막아도 (\w+\s?)+$ 같은 평범한 패턴이 빠져나간다) 음악 재생과 같은 이벤트 루프에서 돌리지 않는다.
// 스레드는 처음 검사할 때 띄우고 계속 재사용한다. 작업은 하나씩 보내고 제한 시간은 그 작업이 시작된 시점부터 잰다(앞 작업을 기다린 시간은 넣지 않는다).
// 제한 시간을 넘기면 스레드를 종료하고(실행 중이던 정규식이 멈춘다) 그 작업만 시간 초과로 처리한다. 대기 중이던 작업은 새 스레드에서 이어서 실행한다

import { Worker } from "worker_threads";

/** 정규식 검사 한 번의 제한 시간이다 */
const MATCH_TIMEOUT_MS = 1000;

/** 정규식 검사 결과다. hits는 일치한 행의 인덱스, timeout은 시간 초과, aborted는 실행 전에 호출한 쪽이 취소해 큐에서 뺀 경우다. 스레드가 실패하면 reject한다 */
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
    else job.reject(new Error(error || "정규식을 검사하지 못했습니다"));
    next();
  });
  one.on("error", (error) => stop(one, error));
  one.on("exit", () => stop(one, new Error("정규식 스레드가 끝났습니다")));
  one.unref(); // 봇이 끝날 때 붙잡지 않는다
  return one;
}

// 실행 중이던 작업을 비우고 반환한다
function finish() {
  const done = running!;
  clearTimeout(done.timer);
  running = null;
  return done;
}

// 대기 중인 작업이 있으면 하나 보낸다
function next() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  const worker = (thread ??= spawn());
  running = { job, timer: setTimeout(() => stop(worker, null), job.timeoutMs) };
  worker.postMessage({ id: job.id, sources: job.sources, rows: job.rows });
}

// 스레드를 종료한다. 실행 중이던 작업은 error가 null이면 시간 초과로, 그 밖의 종료는 실패로 처리하고 대기 중인 작업은 새 스레드에서 실행한다
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
 * 각 행에서 sources 순서의 값(rows)이 모든 정규식(대소문자 무시)과 일치하는 행의 인덱스를 구한다. 빈 값은 일치하지 않는다.
 * signal이 취소되면 큐에서 대기하던 작업은 빼고 aborted로 끝낸다(화면이 취소한 요청이 뒤 작업을 막지 않게). 이미 실행 중인 작업은 제한 시간 안에 끝나므로 그대로 둔다
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
