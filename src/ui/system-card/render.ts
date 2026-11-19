// /system 이미지를 워커 스레드(render-worker)에서 그린다. 메인 스레드가 막히는 것은 워커를 띄우고 값을 넘기는 1ms 이내다.
// 워커는 그릴 때 띄우고, 마지막 그리기 뒤 IDLE_MS 동안 요청이 없으면 글꼴을 지우고 끝낸다(새로고침을 연달아 누르면 같은 워커가 받는다).
// 처음 한 번 불러온 캔버스 모듈이 차지하는 메모리(약 30MB)는 프로세스에 남지만, 워커를 다시 띄워도 더 늘지 않는다.
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
/** 마지막 그리기 뒤 이 시간 동안 요청이 없으면 워커를 끝낸다 */
const IDLE_MS = 60_000;
/** 종료를 요청한 워커가 이 시간 안에 스스로 끝나지 않으면 강제 종료한다 */
const CLOSE_GRACE_MS = 5_000;

type Pngs = { top: Buffer; bottom: Buffer };
type Waiting = { resolve: (pngs: Pngs) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
let thread: Worker | null = null;
const waiting = new Map<number, Waiting>();
let lastId = 0;
let idle: NodeJS.Timeout | null = null;

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

/** 이미지 둘(PNG). 상한을 넘기거나 워커가 죽으면 예외를 던진다 */
function renderSystemCards(data: CardData, { timeoutMs = RENDER_TIMEOUT_MS, idleMs = IDLE_MS }: { timeoutMs?: number; idleMs?: number } = {}): Promise<Pngs> {
  clearIdle();
  const worker = (thread ??= spawn());
  const id = ++lastId;
  const drawn = new Promise<Pngs>((resolve, reject) => {
    const timer = setTimeout(() => {
      failure.fail(`${timeoutMs / 1000}초 안에 끝나지 않아 워커 중단`);
      stop(worker, new Error(`/system 이미지 그리기 시간 초과(${timeoutMs / 1000}초)`));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    worker.postMessage({ id, data });
  });
  return drawn.finally(() => closeWhenIdle(idleMs));
}

/** 지금 워커가 떠 있는지(테스트용) */
const _running = () => thread !== null;

export { renderSystemCards, RENDER_TIMEOUT_MS, _running };
