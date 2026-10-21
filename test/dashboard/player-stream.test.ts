// src/dashboard/player-stream.ts — SSE 연결 회계의 idempotent cleanup
// 쓰기에 실패하면 구독과 함께 perKey(연결 캡)도 정리한다. close 이벤트에만 기대면 close가 안 오는 비정상 종료에서 캡이 영구 점유된다.

import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { fakeWith } from "../helpers/fake.ts";
import { createPlayerStream } from "../../src/dashboard/player-stream.ts";
import config from "../../src/config/index.ts";
import { tunablesChanged } from "../../src/config/tunables-changed.ts";

const { maxPerUser } = config.dashboard.sse;
const DashboardEvents = createPlayerStream();
after(() => DashboardEvents.close());

// 연결 하나. 쓴 것을 모으고, failWrite 면 쓰기가 던진다. closed 는 이미 끊긴 연결
function makeRes({ closed = false } = {}) {
  const res = fakeWith<Response>()(
    Object.assign(new EventEmitter(), {
      writes: [] as string[],
      failWrite: false,
      closed,
      writeHead: () => {},
      flushHeaders: () => {},
      write: (s: string) => {
        if (res.failWrite) throw new Error("EPIPE");
        res.writes.push(s);
      },
      status: (code: number) => {
        res.statusCode = code;
        const sent = { type: () => sent, json: () => sent };
        return sent;
      },
    }),
  );
  return res;
}

// 볼 수 있는 서버(보낼 때 묻는 것)
const sees =
  (...ids: string[]) =>
  (guildId: string) =>
    ids.includes(guildId);

test("쓰기 실패 시 구독 · 연결 캡이 전부 정리됨(close 를 기다리지 않는다)", () => {
  const res = makeRes();
  DashboardEvents.addClient(res, sees("evG2", "evG3"), "evU2");
  assert.equal(DashboardEvents.perKey.get("evU2"), 1);

  res.failWrite = true; // close 이벤트가 오지 않는 비정상 상태 가정
  DashboardEvents._emit("evG2");

  assert.equal(DashboardEvents.subs.size, 0);
  assert.equal(DashboardEvents.perKey.has("evU2"), false, "연결 캡 해제");
});

test("idempotent: 쓰기 실패 정리 후 늦은 close가 와도 이중 감산 없음", () => {
  const resA = makeRes();
  const resB = makeRes();
  DashboardEvents.addClient(resA, sees("evG4"), "evU3");
  DashboardEvents.addClient(resB, sees("evG4"), "evU3");
  assert.equal(DashboardEvents.perKey.get("evU3"), 2);

  resA.failWrite = true;
  DashboardEvents._pingAll(); // resA 정리
  resA.emit("close"); // 뒤늦은 close — 같은 cleanup이라 no-op

  assert.equal(DashboardEvents.perKey.get("evU3"), 1, "resB의 몫은 유지");
  resB.emit("close");
  assert.equal(DashboardEvents.perKey.has("evU3"), false);
});

// 부르는 쪽이 기다리는 사이 끊긴 연결(Node 는 res.closed 로 알린다)
const makeClosed = () => makeRes({ closed: true });

test("등록 전에 끊긴 연결은 받지 않는다(멤버 확인을 기다리는 사이 끊김. 그 뒤 건 close 감시는 불리지 않는다)", () => {
  const gone = makeClosed();
  DashboardEvents.addClient(gone, sees("evG9"), "evU9");
  assert.equal(DashboardEvents.perKey.has("evU9"), false, "연결 캡을 쥐지 않는다");
  assert.equal(DashboardEvents.subs.size, 0);
  assert.deepEqual(gone.writes, []);
});

test("연결 캡: 초과분은 429, 정리 후 재접속 가능", () => {
  const held = [];
  for (let i = 0; i < maxPerUser; i++) {
    const r = makeRes();
    DashboardEvents.addClient(r, sees("evG5"), "evU4");
    held.push(r);
  }
  const over = makeRes();
  DashboardEvents.addClient(over, sees("evG5"), "evU4");
  assert.equal(over.statusCode, 429, "캡 초과 거부");

  held[0].emit("close"); // 슬롯 하나 반환
  const retry = makeRes();
  DashboardEvents.addClient(retry, sees("evG5"), "evU4");
  assert.notEqual(retry.statusCode, 429, "정리 후 재접속 허용");

  for (const r of held.slice(1)) r.emit("close");
  retry.emit("close");
  assert.equal(DashboardEvents.perKey.has("evU4"), false);
});

// 한 연결이 여러 서버를 받는다. 어느 서버의 변화인지 없으면 전부 다시 조회해야 하고,
// 재생 바 · 서버 화면이 자기 서버만 필터링할 수 없다.
test("넛지 페이로드에 guildId가 실린다", () => {
  const res = makeRes();
  DashboardEvents.addClient(res, sees("evG9", "evG8"), "evU9");
  res.writes.length = 0;

  DashboardEvents._emit("evG9");

  assert.equal(res.writes.length, 1);
  const [head, body] = res.writes[0].split("data: ");
  assert.equal(head, "", "SSE data: 필드 하나여야 한다");
  assert.deepEqual(JSON.parse(body.trim()), { t: "changed", g: "evG9" });

  res.emit("close");
});

test("볼 수 없는 서버의 넛지는 받지 않는다. 볼 수 있는지는 보낼 때 물어 연결을 연 뒤 보이게 된 서버도 받는다", () => {
  const res = makeRes();
  const visible = new Set(["evG7"]);
  DashboardEvents.addClient(res, (id: string) => visible.has(id), "evU7");
  res.writes.length = 0;

  DashboardEvents._emit("evG6");
  assert.equal(res.writes.length, 0);
  visible.add("evG6"); // 연결을 연 뒤 들어간 서버
  DashboardEvents._emit("evG6");
  assert.equal(res.writes.length, 1);
  assert.deepEqual([...DashboardEvents.listUsers()], ["evU7"], "연결을 연 사람");

  res.emit("close");
});

// 넛지 합치기: 몰린 알림은 창 하나에 한 번, 창이 끝나면 다시 받는다
test("넛지 합치기: 창 안의 알림은 한 번으로, 창이 지나면 다시 예약한다. 그 서버를 볼 이가 없으면 예약도 안 한다", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const hub = createPlayerStream({ heartbeatMs: 60_000, maxPerUser: 5, coalesceMs: 250 });
  try {
    const res = makeRes();
    hub.addClient(res, sees("cG1"), "cU1");
    const nudges = () => res.writes.filter((w) => w.includes('"t":"changed"')).length;

    hub.notify("cG1");
    hub.notify("cG1");
    mock.timers.tick(249);
    hub.notify("cG1");
    assert.equal(nudges(), 0, "창이 끝나기 전에는 보내지 않는다");
    mock.timers.tick(1);
    assert.equal(nudges(), 1, "창 안의 세 번이 한 번으로");

    hub.notify("cG1");
    mock.timers.tick(250);
    assert.equal(nudges(), 2, "보낸 뒤의 알림은 새 창을 연다");

    hub.notify("cG-nobody");
    assert.equal(hub.coalesceTimers.has("cG-nobody"), false);
  } finally {
    hub.close();
    mock.timers.reset();
  }
});

// 운영 조절값을 저장하면 바로 먹는다. 상한 · 합치기 창은 쓸 때 읽고, 하트비트는 바뀐 간격으로 다시 건다
test("설정 객체를 넘기면 상한 · 하트비트를 다시 시작하지 않고 바꾼다. 닫은 허브는 알림을 안 듣는다", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const options = { heartbeatMs: 60_000, maxPerUser: 1, coalesceMs: 250 };
  const hub = createPlayerStream(options);
  try {
    const one = makeRes();
    hub.addClient(one, sees("hG1"), "hU1");
    const two = makeRes();
    hub.addClient(two, sees("hG1"), "hU1");
    assert.equal(hub.subs.size, 1, "상한 1");
    options.maxPerUser = 2;
    hub.addClient(makeRes(), sees("hG1"), "hU1");
    assert.equal(hub.subs.size, 2, "상한은 쓸 때 읽는다");

    const pings = () => one.writes.filter((w) => w.startsWith(": ping")).length;
    options.heartbeatMs = 10_000;
    tunablesChanged();
    mock.timers.tick(10_000);
    assert.equal(pings(), 1, "바뀐 간격으로 다시 걸었다");
  } finally {
    hub.close();
  }
  options.heartbeatMs = 5_000;
  tunablesChanged();
  assert.equal(hub.heartbeatMs, 10_000, "닫은 허브는 다시 걸지 않는다");
  mock.timers.reset();
});
