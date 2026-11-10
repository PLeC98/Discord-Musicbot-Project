// dashboard/src/utils/event-link.ts: 탭의 SSE 연결: 끊기면 브라우저가 재연결하고, 닫히면 늘려 가는 간격으로 화면이 다시 연다

import { test } from "node:test";
import assert from "node:assert/strict";
import { eventLink } from "../../../dashboard/src/utils/event-link.ts";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/** 가짜 EventSource. 연 것을 순서대로 적는다 */
class FakeSource {
  readyState = CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (e: never) => void>();
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(name: string, fn: (e: never) => void) {
    this.listeners.set(name, fn);
  }
  close() {
    this.closed = true;
    this.readyState = CLOSED;
  }
  opened() {
    this.readyState = OPEN;
    this.onopen?.();
  }
  /** 200 이 아닌 답: 닫히고 재연결하지 않는다 */
  refused() {
    this.readyState = CLOSED;
    this.onerror?.();
  }
  /** 세션이 끝나 서버가 연결을 끊었다(session-ended 이벤트) */
  ended() {
    this.listeners.get("session-ended")?.({} as never);
  }
  /** 연 뒤 끊김: 브라우저가 스스로 재연결하는 중 */
  dropped() {
    this.readyState = CONNECTING;
    this.onerror?.();
  }
}

/** 가짜 시계: 예약된 타이머를 적어 두고 테스트가 하나씩 돌린다 */
function harness({ checks = [] as boolean[] } = {}) {
  const sources: FakeSource[] = [];
  const states: string[] = [];
  const delays: number[] = [];
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let urlCount = 0;
  // 확인마다 조용히(quiet) 호출했는지 기록한다
  const checked: boolean[] = [];
  const clock = { now: 0 };
  const link = eventLink({
    url: () => `/events?n=${++urlCount}`,
    open: (url) => {
      const one = new FakeSource(url);
      sources.push(one);
      return one;
    },
    events: { message: () => {} },
    onState: (state) => states.push(state),
    check: async (quiet) => {
      checked.push(quiet);
      return checks.shift() ?? true;
    },
    now: () => clock.now,
    delay: (attempt) => [2000, 5000, 15000, 30000, 60000][Math.min(attempt, 4)],
    schedule: (fn, ms) => {
      const one = { fn, ms, cancelled: false };
      pending.push(one);
      delays.push(ms);
      return one;
    },
    cancel: (timer) => {
      if (timer) (timer as { cancelled: boolean }).cancelled = true;
    },
  });
  /** 걸린 작업 하나를 돌리고 check 를 기다린다 */
  const tick = async () => {
    const one = pending.shift();
    assert.ok(one, "걸린 작업이 없다");
    if (!one.cancelled) one.fn();
    await new Promise((done) => setImmediate(done));
  };
  return { link, sources, states, delays, pending, tick, checked, clock };
}

test("닫히면(200이 아닌 응답) 2, 5, 15초로 늘려 가며 다시 열고, 열린 채 30초를 버티면 간격을 초기화한다", async () => {
  const h = harness();
  h.link.start();
  h.sources[0].refused();
  await h.tick();
  h.sources[1].refused();
  await h.tick();
  h.sources[2].refused();
  await h.tick();
  assert.deepEqual(h.delays, [2000, 5000, 15000]);
  assert.equal(h.sources.length, 4);
  h.sources[3].opened();
  h.clock.now += 30_000;
  h.sources[3].refused();
  assert.deepEqual(h.delays, [2000, 5000, 15000, 2000]);
  assert.deepEqual(h.states, ["down", "down", "down", "open", "down"]);
});

test("열자마자 또 닫히면 간격을 처음으로 돌리지 않는다(연결과 세션 확인이 어긋나 재연결이 폭주하지 않게)", async () => {
  const h = harness();
  h.link.start();
  h.sources[0].refused();
  await h.tick();
  h.sources[1].opened();
  h.sources[1].refused();
  await h.tick();
  h.sources[2].opened();
  h.sources[2].ended();
  assert.deepEqual(h.delays, [2000, 5000, 15000]);
});

test("브라우저가 자동 재연결한 경우(onopen 재호출)에는 유지 시간을 처음부터 다시 세지 않는다", async () => {
  const h = harness();
  h.link.start();
  h.sources[0].refused();
  await h.tick();
  h.sources[1].refused();
  await h.tick();
  h.sources[2].opened();
  h.clock.now += 60_000;
  h.sources[2].dropped(); // 네트워크가 잠깐 끊겨 브라우저가 재연결한다
  h.sources[2].opened();
  h.clock.now += 1_000;
  h.sources[2].refused(); // 직후 503 응답으로 닫힌다
  assert.deepEqual(h.delays, [2000, 5000, 2000], "한 시간 버틴 연결이라 처음부터");
});

test("세션 끝 이벤트 뒤 확인을 기다리는 사이 다시 열려도 조용한 확인이 남지 않는다", async () => {
  let answer: (ok: boolean) => void = () => {};
  const h = harness();
  const quiet: boolean[] = [];
  const pending: Array<() => void> = [];
  const sources: FakeSource[] = [];
  const link = eventLink({
    url: "/events",
    open: (url) => {
      const one = new FakeSource(url);
      sources.push(one);
      return one;
    },
    events: {},
    check: (q) => {
      quiet.push(q);
      return new Promise<boolean>((done) => (answer = done));
    },
    delay: () => 2000,
    schedule: (fn) => (pending.push(fn), pending.length),
    cancel: () => {},
  });
  void h;
  link.start();
  sources[0].opened();
  sources[0].ended();
  pending.shift()!(); // 재연결 시점이 되어 조용히 세션을 확인한다
  link.start(); // 탭을 오가 곧바로 연다
  answer(true);
  await new Promise((done) => setImmediate(done));
  sources[1].refused();
  pending.shift()!();
  assert.deepEqual(quiet, [true, false], "다음 확인은 조용하지 않다");
});

test("세션 끝 이벤트: 연결을 닫아 끊김을 알리고, 대기 시간 전에는 확인하지 않는다. 첫 확인은 조용히 하고, 또 실패하면 다음 확인에서 세션을 끝낸다", async () => {
  const h = harness({ checks: [false, false] });
  h.link.start();
  h.sources[0].opened();
  h.sources[0].ended();
  assert.equal(h.sources[0].closed, true, "브라우저가 자동 재연결하지 않게 닫는다");
  assert.deepEqual(h.states, ["open", "down"]);
  assert.deepEqual(h.checked, [], "곧바로 확인하지 않는다(다시 로그인한 브라우저의 새 쿠키가 닿기 전이다)");
  await h.tick();
  await h.tick();
  assert.deepEqual(h.checked, [true, false]);
  assert.equal(h.sources.length, 1);
});

test("세션 끝 이벤트 뒤 확인이 되면(다시 로그인했다) 다시 연다", async () => {
  const h = harness({ checks: [true] });
  h.link.start();
  h.sources[0].opened();
  h.sources[0].ended();
  await h.tick();
  assert.deepEqual(h.checked, [true]);
  assert.equal(h.sources.length, 2);
  h.sources[1].refused();
  await h.tick();
  assert.deepEqual(h.checked, [true, false], "조용한 확인은 그 한 번뿐");
});

test("멈춘 뒤 옛 연결의 세션 끝 이벤트는 무시한다", () => {
  const h = harness();
  h.link.start();
  const old = h.sources[0];
  h.link.stop();
  old.ended();
  assert.equal(h.pending.length, 0);
  assert.deepEqual(h.states, []);
});

test("열 때마다 주소를 새로 만든다(운영자 로그의 이어 받기)", async () => {
  const h = harness();
  h.link.start();
  h.sources[0].refused();
  await h.tick();
  assert.deepEqual(
    h.sources.map((one) => one.url),
    ["/events?n=1", "/events?n=2"],
  );
});

test("연 뒤 끊기면 브라우저가 재연결하므로 화면은 다시 열지 않는다", () => {
  const h = harness();
  h.link.start();
  h.sources[0].opened();
  h.sources[0].dropped();
  assert.deepEqual(h.states, ["open", "retrying"]);
  assert.equal(h.pending.length, 0);
  assert.equal(h.sources.length, 1);
});

test("다시 열기 전에 로그인이 살아 있는지 보고, 아니면 열지 않고 다음 간격을 기다린다", async () => {
  const h = harness({ checks: [false, true] });
  h.link.start();
  h.sources[0].refused();
  await h.tick();
  assert.equal(h.sources.length, 1);
  assert.deepEqual(h.delays, [2000, 5000]);
  await h.tick();
  assert.equal(h.sources.length, 2);
});

test("멈추면 닫고, 기다리던 다시 열기도 하지 않는다. 다시 시작하면 바로 연다", async () => {
  const h = harness();
  h.link.start();
  h.sources[0].refused();
  h.link.stop();
  await h.tick();
  assert.equal(h.sources.length, 1);
  assert.equal(h.checked.length, 0, "멈춘 뒤에는 로그인 확인도 하지 않는다");
  h.link.start();
  assert.equal(h.sources.length, 2);
  h.link.stop();
  assert.equal(h.sources[1].closed, true);
});

test("이미 열렸거나 다시 열 때를 기다리면 start 가 겹쳐 열지 않는다", () => {
  const h = harness();
  h.link.start();
  h.link.start();
  assert.equal(h.sources.length, 1);
  h.sources[0].refused();
  h.link.start();
  assert.equal(h.sources.length, 1);
});

test("멈춘 뒤 옛 연결의 오류는 무시한다", () => {
  const h = harness();
  h.link.start();
  const old = h.sources[0];
  h.link.stop();
  h.link.start();
  old.onerror?.();
  assert.equal(h.pending.length, 0);
  assert.deepEqual(h.states, []);
});

test("로그인을 확인하는 사이 멈추면 확인이 끝나도 열지 않는다", async () => {
  let answer: (ok: boolean) => void = () => {};
  const sources: FakeSource[] = [];
  let reopen: () => void = () => {};
  const link = eventLink({
    url: "/events",
    open: (url) => {
      const one = new FakeSource(url);
      sources.push(one);
      return one;
    },
    events: {},
    check: () => new Promise<boolean>((done) => (answer = done)),
    delay: () => 0,
    schedule: (fn) => {
      reopen = fn;
      return 1;
    },
    cancel: () => {},
  });
  link.start();
  sources[0].refused();
  reopen();
  link.stop();
  answer(true);
  await new Promise((done) => setImmediate(done));
  assert.equal(sources.length, 1);
});
