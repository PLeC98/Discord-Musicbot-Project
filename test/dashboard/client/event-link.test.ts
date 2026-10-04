// dashboard/src/utils/event-link.ts — 탭의 실시간 연결: 끊기면 브라우저가 다시 붙고, 닫히면 늘려 가는 간격으로 화면이 다시 연다

import { test } from "node:test";
import assert from "node:assert/strict";
import { eventLink } from "../../../dashboard/src/utils/event-link.ts";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/** 가짜 EventSource. 연 것을 차례로 적는다 */
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
  /** 200 이 아닌 답: 닫히고 다시 붙지 않는다 */
  refused() {
    this.readyState = CLOSED;
    this.onerror?.();
  }
  /** 연 뒤 끊김: 브라우저가 스스로 다시 붙는 중 */
  dropped() {
    this.readyState = CONNECTING;
    this.onerror?.();
  }
}

/** 가짜 시계: 걸린 일을 적어 두고 시험이 하나씩 돌린다 */
function harness({ checks = [] as boolean[] } = {}) {
  const sources: FakeSource[] = [];
  const states: string[] = [];
  const delays: number[] = [];
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let urlCount = 0;
  const checked: number[] = [];
  const link = eventLink({
    url: () => `/events?n=${++urlCount}`,
    open: (url) => {
      const one = new FakeSource(url);
      sources.push(one);
      return one;
    },
    events: { message: () => {} },
    onState: (state) => states.push(state),
    check: async () => {
      checked.push(1);
      return checks.shift() ?? true;
    },
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
  /** 걸린 일 하나를 돌리고 check 를 기다린다 */
  const tick = async () => {
    const one = pending.shift();
    assert.ok(one, "걸린 일이 없다");
    if (!one.cancelled) one.fn();
    await new Promise((done) => setImmediate(done));
  };
  return { link, sources, states, delays, pending, tick, checked };
}

test("닫히면(200 이 아닌 답) 2 · 5 · 15초로 늘려 가며 다시 열고, 열리면 간격을 처음부터", async () => {
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
  h.sources[3].refused();
  assert.deepEqual(h.delays, [2000, 5000, 15000, 2000]);
  assert.deepEqual(h.states, ["down", "down", "down", "open", "down"]);
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

test("연 뒤 끊기면 브라우저가 다시 붙으므로 화면은 다시 열지 않는다", () => {
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

test("이미 열렸거나 다시 열 차례를 기다리면 start 가 겹쳐 열지 않는다", () => {
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
