"use strict";

// src/DashboardEvents.js — SSE 연결 회계의 idempotent cleanup (감사 L-06).
// 회귀 대상: 쓰기 실패 시 Set에서만 제거되고 perKey(연결 캡)·listGuildIds·빈 Set 정리가
// close 이벤트에만 의존 — close가 안 오는 비정상 종료에서 캡이 영구 점유되던 문제.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const DashboardEvents = require("../src/DashboardEvents");
const config = require("../config");

const { maxPerUser } = config.dashboard.sse;

function makeRes() {
  const res = new EventEmitter();
  res.writes = [];
  res.failWrite = false;
  res.writeHead = () => {};
  res.flushHeaders = () => {};
  res.write = (s) => {
    if (res.failWrite) throw new Error("EPIPE");
    res.writes.push(s);
  };
  res.status = (code) => {
    res.statusCode = code;
    return { json: () => {} };
  };
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

test("목록 구독: 쓰기 실패 시 listSubs·listGuildIds·캡 정리", () => {
  const res = makeRes();
  DashboardEvents.addListClient(res, new Set(["evG2", "evG3"]), "evU2");
  assert.equal(DashboardEvents.listGuildIds.get("evG2"), 1);

  res.failWrite = true;
  DashboardEvents._emit("evG2");

  assert.equal(DashboardEvents.listSubs.size, 0);
  assert.equal(DashboardEvents.listGuildIds.has("evG2"), false);
  assert.equal(DashboardEvents.listGuildIds.has("evG3"), false);
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
