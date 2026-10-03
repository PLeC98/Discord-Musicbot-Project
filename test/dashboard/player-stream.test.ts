// src/dashboard/player-stream.ts — SSE 연결 회계의 idempotent cleanup
// 회귀 대상: 쓰기 실패 시 Set에서만 제거되고 perKey(연결 캡)·listGuildIds·빈 Set 정리가
// close 이벤트에만 의존 — close가 안 오는 비정상 종료에서 캡이 영구 점유되던 문제.

import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { fakeWith } from "../helpers/fake.ts";
import { createPlayerStream } from "../../src/dashboard/player-stream.ts";
import config from "../../src/config/index.ts";

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

test("개별 구독: 쓰기 실패 시 Set·빈 Set·연결 캡이 전부 정리됨 (L-06 회귀 — close 불필요)", () => {
  const res = makeRes();
  DashboardEvents.addClient("evG1", res, "evU1");
  assert.equal(DashboardEvents.perKey.get("evU1"), 1);

  res.failWrite = true; // close 이벤트가 오지 않는 비정상 상태 가정
  DashboardEvents._emit("evG1");

  assert.equal(DashboardEvents.guilds.has("evG1"), false, "빈 Set까지 제거");
  assert.equal(DashboardEvents.perKey.has("evU1"), false, "연결 캡 해제 — 구 코드는 영구 점유");
});

// 볼 수 있는 서버(목록 구독이 보낼 때 묻는 것)
const sees =
  (...ids: string[]) =>
  (guildId: string) =>
    ids.includes(guildId);

test("목록 구독: 쓰기 실패 시 listSubs·캡 정리", () => {
  const res = makeRes();
  DashboardEvents.addListClient(res, sees("evG2", "evG3"), "evU2");
  assert.equal(DashboardEvents.perKey.get("evU2"), 1);

  res.failWrite = true;
  DashboardEvents._emit("evG2");

  assert.equal(DashboardEvents.listSubs.size, 0);
  assert.equal(DashboardEvents.perKey.has("evU2"), false);
  assert.equal(DashboardEvents.perKey.has("evU2"), false);
});

test("idempotent: 쓰기 실패 정리 후 늦은 close가 와도 이중 감산 없음", () => {
  const resA = makeRes();
  const resB = makeRes();
  DashboardEvents.addClient("evG4", resA, "evU3");
  DashboardEvents.addClient("evG4", resB, "evU3");
  assert.equal(DashboardEvents.perKey.get("evU3"), 2);

  resA.failWrite = true;
  DashboardEvents._pingAll(); // resA 정리
  resA.emit("close"); // 뒤늦은 close — 같은 cleanup이라 no-op

  assert.equal(DashboardEvents.perKey.get("evU3"), 1, "resB의 몫은 유지");
  resB.emit("close");
  assert.equal(DashboardEvents.perKey.has("evU3"), false);
});

test("등록 전에 끊긴 연결은 받지 않는다(멤버 확인을 기다리는 사이 끊김. 그 뒤 건 close 감시는 불리지 않는다)", () => {
  const gone = makeClosed();
  DashboardEvents.addClient("evG9", gone, "evU9");
  DashboardEvents.addListClient(makeClosed(), sees("evG9"), "evU9");
  assert.equal(DashboardEvents.perKey.has("evU9"), false, "연결 캡을 쥐지 않는다");
  assert.equal(DashboardEvents.guilds.has("evG9"), false);
  assert.equal(DashboardEvents.listSubs.size, 0);
  assert.deepEqual(gone.writes, []);
});

// 부르는 쪽이 기다리는 사이 끊긴 연결(Node 는 res.closed 로 알린다)
const makeClosed = () => makeRes({ closed: true });

test("연결 캡: 초과분은 429, 정리 후 재접속 가능", () => {
  const held = [];
  for (let i = 0; i < maxPerUser; i++) {
    const r = makeRes();
    DashboardEvents.addClient("evG5", r, "evU4");
    held.push(r);
  }
  const over = makeRes();
  DashboardEvents.addClient("evG5", over, "evU4");
  assert.equal(over.statusCode, 429, "캡 초과 거부");

  held[0].emit("close"); // 한 자리 반환
  const retry = makeRes();
  DashboardEvents.addClient("evG5", retry, "evU4");
  assert.notEqual(retry.statusCode, 429, "정리 후 재접속 허용");

  for (const r of held.slice(1)) r.emit("close");
  retry.emit("close");
  assert.equal(DashboardEvents.perKey.has("evU4"), false);
});

// 목록 구독은 여러 서버를 한 연결로 받는다. 어느 서버의 변화인지 없으면 전부 다시 조회해야 하고,
// 전역 재생 바가 자기 대상 서버만 골라낼 수 없다.
test("넛지 페이로드에 guildId가 실린다", () => {
  const res = makeRes();
  DashboardEvents.addListClient(res, sees("evG9", "evG8"), "evU9");
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
  DashboardEvents.addListClient(res, (id) => visible.has(id), "evU7");
  res.writes.length = 0;

  DashboardEvents._emit("evG6");
  assert.equal(res.writes.length, 0);
  visible.add("evG6"); // 연결을 연 뒤 들어간 서버
  DashboardEvents._emit("evG6");
  assert.equal(res.writes.length, 1);
  assert.deepEqual([...DashboardEvents.listUsers()], ["evU7"], "목록 연결을 연 사람");

  res.emit("close");
});

// 넛지 합치기: 몰린 알림은 창 하나에 한 번, 창이 끝나면 다시 받는다
test("넛지 합치기: 창 안의 알림은 한 번으로, 창이 지나면 다시 예약한다. 보는 이가 없으면 예약도 안 한다", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const hub = createPlayerStream({ heartbeatMs: 60_000, maxPerUser: 5, coalesceMs: 250 });
  try {
    const res = makeRes();
    hub.addClient("cG1", res, "cU1");
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
