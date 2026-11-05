// 캐시 DB 의 정규식 필터를 따로 도는 스레드(regex-filter-worker)에서 맞춘다. 정규식은 무늬에 따라 백트래킹이 끝없이 늘 수 있어
// (겹친 반복을 막아도 (\w+\s?)+$ 같은 평범한 무늬가 빠져나간다) 음악 재생과 같은 이벤트 루프에서 돌리지 않는다.
// 스레드는 처음 맞출 때 띄우고 계속 쓴다. 상한을 넘기면 스레드를 끝내고(돌던 정규식이 멈춘다) 다음에 새로 띄운다

import { Worker } from "worker_threads";

/** 맞추기 한 번의 상한 */
const MATCH_TIMEOUT_MS = 1000;

type Waiting = { resolve: (hits: number[] | null) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
let thread: Worker | null = null;
const waiting = new Map<number, Waiting>();
let lastId = 0;

function spawn() {
  const one = new Worker(new URL("./regex-filter-worker.ts", import.meta.url));
  one.on("message", ({ id, hits, error }: { id: number; hits?: number[]; error?: string }) => {
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    clearTimeout(job.timer);
    if (hits) job.resolve(hits);
    else job.reject(new Error(error || "정규식을 맞추지 못했습니다"));
  });
  one.on("error", (error) => stop(one, error));
  one.on("exit", () => stop(one, new Error("정규식 스레드가 끝났습니다")));
  one.unref(); // 봇이 끝날 때 붙잡지 않는다
  return one;
}

// 스레드를 끝내고 맡긴 일을 결과로 돌린다. 상한을 넘긴 것은 null(시간 초과), 그 밖의 끝남은 실패
function stop(one: Worker, error: Error | null) {
  if (thread !== one) return;
  thread = null;
  for (const job of waiting.values()) {
    clearTimeout(job.timer);
    if (error) job.reject(error);
    else job.resolve(null);
  }
  waiting.clear();
  void one.terminate();
}

/**
 * 행마다 sources 차례의 값(rows)이 모든 정규식(대소문자 무시)에 맞는 행의 번호. 빈 값은 맞지 않는다.
 * 상한을 넘기면 null(시간 초과. 함께 기다리던 맞추기도 null)
 */
function matchRegexes(sources: string[], rows: Array<Array<string | null>>, { timeoutMs = MATCH_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<number[] | null> {
  const worker = (thread ??= spawn());
  const id = ++lastId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => stop(worker, null), timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    worker.postMessage({ id, sources, rows });
  });
}

export { matchRegexes, MATCH_TIMEOUT_MS };
