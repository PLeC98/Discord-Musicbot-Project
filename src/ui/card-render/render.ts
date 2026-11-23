// 봇이 그리는 이미지(/system 카드, /queue 썸네일 모자이크)를 워커 스레드(render-worker)에서 그린다. 메인 스레드가 막히는 것은 워커를 띄우고 값을 넘기는 1ms 이내다.
// 워커는 그릴 때 띄우고, 마지막 그리기 뒤 IDLE_MS 동안 요청이 없으면 글꼴을 지우고 끝낸다(새로고침, 쪽 넘기기를 연달아 누르면 같은 워커가 받는다).
// 처음 한 번 불러온 캔버스 모듈의 메모리는 프로세스에 남지만, 워커를 다시 띄워도 더 늘지 않는다.
// 그리기를 요청한 시점부터 상한을 넘기거나 워커가 죽으면(캔버스 바이너리가 없는 플랫폼 등) 워커를 종료하고, 요청한 그리기는 실패 처리한다. 다음 그리기는 새 워커에서.
// 상한으로 종료하면 글꼴을 지우지 못해 메모리가 남으므로, 기다릴 수 없는 호출부는 상한을 줄이지 말고 결과를 기다리지 않는 쪽으로 처리한다

import { Worker } from "node:worker_threads";
import logger from "../../infra/log/logger.ts";
import { repeatingFailure } from "../../infra/repeating-failure.ts";
import { messageOf } from "../../rules/error-kind.ts";
import type { CardData } from "../system-card/draw.ts";
import type { MosaicData } from "../queue-mosaic/layout.ts";
import { L } from "../../infra/log/text.ts";
import { logTextError, type LogText } from "../../infra/log/log-text.ts";

const log = logger.child({ category: "commands" });
const failing = (what: string | LogText) => repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, what);

/** 그리는 일. 워커가 kind로 고른다 */
type Job = { kind: "system"; data: CardData } | { kind: "queue"; data: MosaicData };
const failures: Record<Job["kind"], ReturnType<typeof failing>> = { system: failing(L.commands.systemRenderLabel()), queue: failing(L.commands.queueRenderLabel()) };
const workerFailure = failing(L.commands.renderWorkerLabel());

/** 그리기 하나의 상한(ms). 처음 그리기는 워커 띄우기, 모듈 로드, 글꼴 등록이 더해진다 */
const RENDER_TIMEOUT_MS = 15_000;
/** 마지막 그리기 뒤 이 시간 동안 요청이 없으면 워커를 끝낸다 */
const IDLE_MS = 60_000;
/** 종료를 요청한 워커가 이 시간 안에 스스로 끝나지 않으면 강제 종료한다 */
const CLOSE_GRACE_MS = 5_000;

type Options = { timeoutMs?: number; idleMs?: number };
type Waiting = { kind: Job["kind"]; resolve: (images: Buffer[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
let thread: Worker | null = null;
const waiting = new Map<number, Waiting>();
let lastId = 0;
let idle: NodeJS.Timeout | null = null;

function spawn() {
  const one = new Worker(new URL("./render-worker.ts", import.meta.url));
  one.on("message", ({ id, images, error }: { id: number; images?: ArrayBuffer[]; error?: string }) => {
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    clearTimeout(job.timer);
    if (images) {
      failures[job.kind].ok();
      workerFailure.ok();
      job.resolve(images.map((one) => Buffer.from(one)));
    } else {
      failures[job.kind].fail(error || L.commands.renderCauseUnknown());
      job.reject(error ? new Error(error) : logTextError(L.commands.renderFailed()));
    }
  });
  one.on("error", (error) => {
    workerFailure.fail(L.commands.renderWorkerStopped({ error: messageOf(error) }));
    stop(one, error);
  });
  one.on("exit", (code) => {
    if (thread === one) workerFailure.fail(L.commands.renderWorkerExitedCode({ code }));
    stop(one, logTextError(L.commands.renderWorkerExited({ code })));
  });
  one.unref(); // 봇이 끝날 때 붙잡지 않는다
  return one;
}

// 워커를 종료하고 대기 중인 그리기 요청을 모두 실패 처리한다
function stop(one: Worker, error: Error) {
  if (thread !== one) return;
  thread = null;
  clearIdle();
  for (const job of waiting.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  waiting.clear();
  void one.terminate();
}

function clearIdle() {
  if (idle) clearTimeout(idle);
  idle = null;
}

// 남은 그리기가 없으면 idleMs 뒤에 워커가 글꼴을 지우고 스스로 끝나게 한다. 새 그리기는 새 워커에서
function closeWhenIdle(idleMs: number) {
  clearIdle();
  if (waiting.size || !thread) return;
  const one = thread;
  idle = setTimeout(() => {
    idle = null;
    if (thread !== one || waiting.size) return;
    thread = null;
    one.postMessage({ close: true });
    setTimeout(() => void one.terminate(), CLOSE_GRACE_MS).unref();
  }, idleMs);
  idle.unref();
}

/** 일 하나를 워커에 맡긴다. 이미지들(일마다 정한 순서). 상한을 넘기거나 워커가 죽으면 예외를 던진다 */
function render(job: Job, { timeoutMs = RENDER_TIMEOUT_MS, idleMs = IDLE_MS }: Options = {}): Promise<Buffer[]> {
  clearIdle();
  const worker = (thread ??= spawn());
  const id = ++lastId;
  const drawn = new Promise<Buffer[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      failures[job.kind].fail(L.commands.renderWorkerTimedOut({ seconds: timeoutMs / 1000 }));
      stop(worker, logTextError(L.commands.renderTimedOut({ seconds: timeoutMs / 1000 })));
    }, timeoutMs);
    waiting.set(id, { kind: job.kind, resolve, reject, timer });
    worker.postMessage({ id, job });
  });
  return drawn.finally(() => closeWhenIdle(idleMs));
}

/** /system 이미지 둘(PNG) */
const renderSystemCards = (data: CardData, options?: Options) => render({ kind: "system", data }, options).then(([top, bottom]) => ({ top, bottom }));

/** /queue 썸네일 모자이크(WebP) */
const renderQueueMosaic = (data: MosaicData, options?: Options) => render({ kind: "queue", data }, options).then(([image]) => image);

/** 지금 워커가 떠 있는지(테스트용) */
const _running = () => thread !== null;

export { renderSystemCards, renderQueueMosaic, RENDER_TIMEOUT_MS, _running };
export type { Job };
