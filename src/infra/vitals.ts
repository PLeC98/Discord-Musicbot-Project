// 봇 프로세스와 기계의 측정값: CPU 사용률 · 이벤트 루프 지연 · heap 한도.
// 3초마다 CPU 를 재고(지난 3초), 15초마다 한 구간을 닫는다(그 15초의 CPU 평균 · 루프 지연 p99 · 최대). 구간을 닫을 때 onWindow 로 알린다.
// 사용률은 쓴 CPU 시간의 차이로 잰다(운영체제와 상관없다. loadavg 는 Windows 에서 늘 0 이다). 모든 코어를 합쳐 100

import os from "node:os";
import v8 from "node:v8";
import { monitorEventLoopDelay } from "node:perf_hooks";

const TICK_MS = 3000;
const WINDOW_TICKS = 5;
const WINDOW_MS = TICK_MS * WINDOW_TICKS;

type Cpu = { bot: number; system: number };
type Window = { cpu: Cpu; loop: { p99: number; max: number } };

/** 지금까지 쓴 CPU 시간(마이크로초): 봇 프로세스 · 모든 코어의 바쁜 시간과 전체 시간 */
function cpuTimes() {
  const usage = process.cpuUsage();
  let busy = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    const all = times.user + times.nice + times.sys + times.irq + times.idle;
    busy += all - times.idle;
    total += all;
  }
  // os.cpus 는 밀리초
  return { at: performance.now() * 1000, bot: usage.user + usage.system, busy: busy * 1000, total: total * 1000 };
}
type Mark = ReturnType<typeof cpuTimes>;

const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
function cpuBetween(from: Mark, to: Mark): Cpu {
  const elapsed = (to.at - from.at) * os.availableParallelism();
  return { bot: elapsed > 0 ? pct(((to.bot - from.bot) / elapsed) * 100) : 0, system: to.total > from.total ? pct(((to.busy - from.busy) / (to.total - from.total)) * 100) : 0 };
}

let timer: NodeJS.Timeout | null = null;
let histogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
let lastTick: Mark | null = null;
let windowStart: Mark | null = null;
let ticks = 0;
let live: Cpu = { bot: 0, system: 0 };
let closed: Window = { cpu: { bot: 0, system: 0 }, loop: { p99: 0, max: 0 } };
const listeners = new Set<(window: Window) => void>();

const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;

function tick() {
  const now = cpuTimes();
  if (lastTick) live = cpuBetween(lastTick, now);
  lastTick = now;
  if (++ticks % WINDOW_TICKS) return;

  // 한 구간을 닫는다
  const h = histogram!;
  closed = { cpu: cpuBetween(windowStart!, now), loop: { p99: h.count ? ms(h.percentile(99)) : 0, max: h.count ? ms(h.max) : 0 } };
  h.reset();
  windowStart = now;
  for (const fn of listeners) fn(closed);
}

/** 재기 시작한다. 두 번 불러도 하나만 돈다. 봇이 내려가는 것을 막지 않는다 */
function startVitals() {
  if (timer) return;
  histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  lastTick = windowStart = cpuTimes();
  timer = setInterval(tick, TICK_MS).unref();
}

function stopVitals() {
  if (timer) clearInterval(timer);
  histogram?.disable();
  timer = histogram = lastTick = windowStart = null;
  ticks = 0;
  live = { bot: 0, system: 0 };
  closed = { cpu: live, loop: { p99: 0, max: 0 } };
  listeners.clear();
}

/** 15초 구간을 닫을 때마다. 끊는 함수를 돌려준다 */
function onWindow(fn: (window: Window) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 지금 값. cpu 는 지난 3초, loop 는 지난 15초 구간(ms), heapLimit 은 V8 heap 한도(MB) */
function vitals() {
  return { cpu: live, loop: closed.loop, heapLimit: Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024) };
}

/** 테스트: 3초를 기다리지 않고 한 번 잰다 */
const _tick = tick;

export { startVitals, stopVitals, onWindow, vitals, WINDOW_MS, _tick };
export type { Window };
