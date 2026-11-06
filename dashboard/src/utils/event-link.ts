// SSE 연결(EventSource) 하나를 들고 있다.
// 200 으로 연 뒤 끊기면 브라우저가 스스로 재연결한다(마지막 id 를 싣는다). 200 이 아닌 답(상한, 준비 전, 세션 끝)이면 닫히고 재연결하지 않아,
// 늘려 가는 간격(utils/reconnect)으로 화면이 다시 연다. 다시 열기 전에 check 로 로그인이 살아 있는지 본다(401 이면 요청 한 곳이 세션 끝으로 돌린다).
// 서버가 세션이 끝나 끊으면(session-ended) 브라우저가 스스로 다시 붙지 않게 닫고 다음 차례에 확인한다. 곧바로 묻지 않는다:
// 다시 로그인하면 서버가 옛 세션을 먼저 끝내 새 쿠키가 닿기 전에 이 이벤트가 온다. 그 뒤 첫 확인은 조용히(세션 끝으로 돌리지 않고) 한 번 더 기다린다.
// 간격은 열린 채 HEALTHY_MS 가 지나야 처음으로 돌아간다(열자마자 또 끝나는 일이 되풀이되면 늘어난다)

import { reopenDelay } from "./reconnect.ts";

const CLOSED = 2; // EventSource.CLOSED

/** 열린 채 이만큼 버텨야 다시 열기 간격이 처음으로 돌아간다 */
const HEALTHY_MS = 30_000;

/** 이 모듈이 쓰는 EventSource 의 부분(테스트는 가짜를 넘긴다) */
type Source = { readyState: number; onopen: ((event: Event) => void) | null; onerror: ((event: Event) => void) | null; addEventListener(name: string, fn: (event: MessageEvent) => void): void; close(): void };
/** 열림, 브라우저가 재연결하는 중, 닫혀 화면이 다시 열 차례를 기다림 */
type LinkState = "open" | "retrying" | "down";

type LinkOptions = {
  /** 열 주소. 함수면 열 때마다 부른다 */
  url: string | (() => string);
  /** EventSource 를 만든다 */
  open: (url: string) => Source;
  /** 이벤트 이름 → 받는 함수 */
  events: Record<string, (event: MessageEvent) => void>;
  onState?: (state: LinkState) => void;
  /** 다시 열어도 되는지(로그인이 살아 있는지). quiet: 401 이어도 세션 끝으로 돌리지 않는다(세션 끝 이벤트 뒤의 첫 확인) */
  check?: (quiet: boolean) => Promise<boolean>;
  delay?: (attempt: number) => number;
  /** 다시 열 차례를 예약한다. 돌려준 것은 cancel 에 그대로 넘긴다 */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
  now?: () => number;
};

/** schedule, cancel, delay, now 는 테스트가 바꾼다 */
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
  now = () => Date.now(),
}: LinkOptions): { start(): void; stop(): void } {
  let source: Source | null = null;
  let timer: unknown;
  let attempt = 0;
  let wanted = false;
  let openedAt: number | null = null;
  // 세션 끝 이벤트 뒤 아직 조용히 확인할 횟수
  let quietChecks = 0;

  function connect() {
    const one = open(typeof url === "function" ? url() : url);
    source = one;
    quietChecks = 0;
    one.onopen = () => {
      // 브라우저가 스스로 다시 붙은 것은 그대로 이어진 연결로 센다(다시 붙을 때마다 처음부터 세면 오래 버틴 연결의 간격이 처음으로 돌아가지 않는다)
      openedAt ??= now();
      onState("open");
    };
    for (const [name, fn] of Object.entries(events)) one.addEventListener(name, fn);
    one.addEventListener("session-ended", () => {
      if (source !== one) return;
      one.close();
      closed();
      quietChecks = 1;
      reopenLater();
    });
    one.onerror = () => {
      if (source !== one) return;
      if (one.readyState !== CLOSED) return onState("retrying");
      closed();
      reopenLater();
    };
  }

  // 연결을 잃었다. 열린 채 오래 버텼으면 간격을 처음부터
  function closed() {
    source = null;
    if (openedAt !== null && now() - openedAt >= HEALTHY_MS) attempt = 0;
    openedAt = null;
    onState("down");
  }

  // 다시 열 차례. 로그인이 살아 있으면 열고, 아니면 다음 차례를 예약한다
  async function reopen() {
    timer = undefined;
    const quiet = quietChecks > 0;
    let ok;
    try {
      ok = await check(quiet);
    } catch {
      ok = false;
    }
    if (quiet) quietChecks = Math.max(0, quietChecks - 1);
    if (!wanted || source || timer !== undefined) return;
    if (ok) {
      quietChecks = 0;
      connect();
    } else reopenLater();
  }

  function reopenLater() {
    timer = schedule(() => void reopen(), delay(attempt++));
  }

  return {
    /** 열어 둔다. 이미 열렸거나 다시 열 차례를 기다리면 그대로 */
    start() {
      wanted = true;
      if (!source && timer === undefined) connect();
    },
    /** 닫고 다시 열지 않는다(탭이 숨음, 세션 끝, 화면을 떠남) */
    stop() {
      wanted = false;
      cancel(timer);
      timer = undefined;
      source?.close();
      source = null;
      attempt = 0;
      openedAt = null;
      quietChecks = 0;
    },
  };
}

export type { Source, LinkState };
