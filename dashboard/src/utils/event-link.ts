// 실시간 연결(EventSource) 하나를 들고 있다.
// 200 으로 연 뒤 끊기면 브라우저가 스스로 다시 붙는다(마지막 id 를 싣는다). 200 이 아닌 답(상한 · 준비 전 · 세션 끝)이면 닫히고 다시 붙지 않아,
// 늘려 가는 간격(utils/reconnect)으로 화면이 다시 연다. 다시 열기 전에 check 로 로그인이 살아 있는지 본다(401 이면 요청 한 곳이 세션 끝으로 돌린다)

import { reopenDelay } from "./reconnect.ts";

const CLOSED = 2; // EventSource.CLOSED

/** 이 모듈이 쓰는 EventSource 의 부분(시험은 가짜를 넘긴다) */
type Source = { readyState: number; onopen: ((event: Event) => void) | null; onerror: ((event: Event) => void) | null; addEventListener(name: string, fn: (event: MessageEvent) => void): void; close(): void };
/** 열림 · 브라우저가 다시 붙는 중 · 닫혀 화면이 다시 열 차례를 기다림 */
type LinkState = "open" | "retrying" | "down";

type LinkOptions = {
  /** 열 주소. 함수면 열 때마다 부른다 */
  url: string | (() => string);
  /** EventSource 를 만든다 */
  open: (url: string) => Source;
  /** 이벤트 이름 → 받는 함수 */
  events: Record<string, (event: MessageEvent) => void>;
  onState?: (state: LinkState) => void;
  /** 다시 열어도 되는지(로그인이 살아 있는지) */
  check?: () => Promise<boolean>;
  delay?: (attempt: number) => number;
  /** 다시 열 차례를 건다. 돌려준 것은 cancel 에 그대로 넘긴다 */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
};

/** schedule · cancel · delay 는 시험이 바꾼다 */
export function eventLink({
  url,
  open,
  events,
  onState = () => {
    /* 상태를 보지 않는 쪽 */
  },
  check = async () => true,
  delay = reopenDelay,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => {
    if (typeof timer === "number") clearTimeout(timer);
  },
}: LinkOptions): { start(): void; stop(): void } {
  let source: Source | null = null;
  let timer: unknown;
  let attempt = 0;
  let wanted = false;

  function connect() {
    const one = open(typeof url === "function" ? url() : url);
    source = one;
    one.onopen = () => {
      attempt = 0;
      onState("open");
    };
    for (const [name, fn] of Object.entries(events)) one.addEventListener(name, fn);
    one.onerror = () => {
      if (source !== one) return;
      if (one.readyState !== CLOSED) return onState("retrying");
      source = null;
      onState("down");
      reopenLater();
    };
  }

  function reopenLater() {
    timer = schedule(async () => {
      timer = undefined;
      let ok;
      try {
        ok = await check();
      } catch {
        ok = false;
      }
      if (!wanted || source || timer !== undefined) return;
      if (ok) connect();
      else reopenLater();
    }, delay(attempt++));
  }

  return {
    /** 열어 둔다. 이미 열렸거나 다시 열 차례를 기다리면 그대로 */
    start() {
      wanted = true;
      if (!source && timer === undefined) connect();
    },
    /** 닫고 다시 열지 않는다(탭이 숨음 · 세션 끝 · 화면을 떠남) */
    stop() {
      wanted = false;
      cancel(timer);
      timer = undefined;
      source?.close();
      source = null;
      attempt = 0;
    },
  };
}

export type { Source, LinkState };
