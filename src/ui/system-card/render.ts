// /system 이미지를 워커 스레드(render-worker)에서 그린다. 메인 스레드가 막히는 것은 워커를 띄우고 값을 넘기는 1ms 이내다.
// 워커는 처음 그릴 때 띄워 계속 유지한다. 종료해도 네이티브 모듈과 글꼴 캐시가 프로세스에 남아 메모리가 완전히 해제되지 않고, 다시 띄울 때마다 늘어난다.
// 그리기를 요청한 시점부터 상한을 넘기거나 워커가 죽으면(캔버스 바이너리가 없는 플랫폼 등) 워커를 종료하고, 요청한 그리기는 실패 처리한다. 다음 그리기는 새 워커에서

import { Worker } from "node:worker_threads";
import logger from "../../infra/log/logger.ts";
import { repeatingFailure } from "../../infra/repeating-failure.ts";
import { messageOf } from "../../rules/error-kind.ts";
import type { CardData } from "./draw.ts";

const log = logger.child({ category: "commands" });
const failure = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "/system 이미지 그리기");

/** 그리기 하나의 상한. 처음에는 워커 띄우기, 모듈 로드, 글꼴 등록이 더해져 300ms 쯤 걸린다(이 PC) */
const RENDER_TIMEOUT_MS = 15_000;

type Pngs = { top: Buffer; bottom: Buffer };
type Waiting = { resolve: (pngs: Pngs) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
let thread: Worker | null = null;
const waiting = new Map<number, Waiting>();
let lastId = 0;

function spawn() {
  const one = new Worker(new URL("./render-worker.ts", import.meta.url));
  one.on("message", ({ id, top, bottom, error }: { id: number; top?: ArrayBuffer; bottom?: ArrayBuffer; error?: string }) => {
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    clearTimeout(job.timer);
    if (top && bottom) {
      failure.ok();
      job.resolve({ top: Buffer.from(top), bottom: Buffer.from(bottom) });
    } else {
      failure.fail(error || "원인 불명");
      job.reject(new Error(error || "그리기 실패"));
    }
  });
  one.on("error", (error) => {
    failure.fail(`워커 중단(${messageOf(error)})`);
    stop(one, error);
  });
  one.on("exit", (code) => {
    if (thread === one) failure.fail(`워커 비정상 종료(종료 코드=${code})`);
    stop(one, new Error(`그리기 워커가 종료됨(종료 코드=${code})`));
  });
  one.unref(); // 봇이 끝날 때 붙잡지 않는다
  return one;
}

// 워커를 종료하고 대기 중인 그리기 요청을 모두 실패 처리한다
function stop(one: Worker, error: Error) {
  if (thread !== one) return;
  thread = null;
  for (const job of waiting.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  waiting.clear();
  void one.terminate();
}

/** 이미지 둘(PNG). 상한을 넘기거나 워커가 죽으면 예외를 던진다 */
function renderSystemCards(data: CardData, { timeoutMs = RENDER_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<Pngs> {
  const worker = (thread ??= spawn());
  const id = ++lastId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      failure.fail(`${timeoutMs / 1000}초 안에 끝나지 않아 워커 중단`);
      stop(worker, new Error(`/system 이미지 그리기 시간 초과(${timeoutMs / 1000}초)`));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    worker.postMessage({ id, data });
  });
}

export { renderSystemCards, RENDER_TIMEOUT_MS };
