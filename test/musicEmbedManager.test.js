"use strict";

// src/MusicEmbedManager.js — 길드별 음악 처리 락 (Promise tail 체인).
// 실제 처리(_processMusic)는 스텁하고 직렬화 계약만 검증한다.
// 회귀 대상: 구 "await 후 set" 방식의 A/B/C 경쟁 (앞 작업 finally가 뒤 작업 락을 삭제 → 동시 실행)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const MusicEmbedManager = require("../src/MusicEmbedManager");

function deferred() {
  let resolve, reject;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

// _processMusic을 수동 제어 가능한 스텁으로 교체한 인스턴스
function makeManager() {
  const mem = new MusicEmbedManager({ players: new Map() });
  const events = [];
  const gates = new Map(); // id -> deferred (테스트가 완료 시점을 제어)
  let active = 0;
  let maxActive = 0;

  mem._processMusic = async (guildId, trackData) => {
    active++;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${trackData.id}`);
    const gate = deferred();
    gates.set(trackData.id, gate);
    try {
      await gate.p;
      events.push(`end:${trackData.id}`);
      return trackData.id;
    } finally {
      active--;
    }
  };

  const stats = { events, gates };
  Object.defineProperty(stats, "maxActive", { get: () => maxActive });
  return { mem, stats };
}

const tick = () => new Promise((r) => setImmediate(r));

test("같은 길드 동시 3건(A/B/C)은 항상 순차 실행 — 구 락 경쟁 회귀 방지", async () => {
  const { mem, stats } = makeManager();

  // 동기적으로 연속 진입 (실사용: 동시 /play + 메시지 추가 + 검색 선택)
  const pA = mem.handleMusicData("g1", { id: "A" }, null);
  const pB = mem.handleMusicData("g1", { id: "B" }, null);
  const pC = mem.handleMusicData("g1", { id: "C" }, null);

  await tick();
  assert.deepEqual(stats.events, ["start:A"], "A만 시작 — B/C는 대기");

  stats.gates.get("A").resolve();
  assert.equal(await pA, "A");
  await tick();
  assert.deepEqual(stats.events, ["start:A", "end:A", "start:B"], "A 종료 후에야 B 시작");

  // 원 버그의 핵심 시나리오: B 실행 중에 D가 도착 — A의 정리가 락을 지웠다면 D는 B와 동시 실행됐다
  const pD = mem.handleMusicData("g1", { id: "D" }, null);
  await tick();
  assert.ok(!stats.events.includes("start:D"), "B 실행 중 도착한 D는 대기");

  stats.gates.get("B").resolve();
  assert.equal(await pB, "B");
  stats.gates.get("C").resolve();
  await tick();
  assert.equal(await pC, "C");
  stats.gates.get("D").resolve();
  assert.equal(await pD, "D");

  assert.equal(stats.maxActive, 1, "동시 실행은 항상 최대 1");
  assert.deepEqual(stats.events, ["start:A", "end:A", "start:B", "end:B", "start:C", "end:C", "start:D", "end:D"]);
  assert.equal(mem.processingQueue.size, 0, "전부 끝나면 락 맵 비움");
});

test("앞 작업 실패가 뒤 작업을 막지 않음 — 오류는 자기 호출자에게만", async () => {
  const { mem, stats } = makeManager();

  const pA = mem.handleMusicData("g1", { id: "A" }, null);
  const pB = mem.handleMusicData("g1", { id: "B" }, null);

  await tick();
  stats.gates.get("A").reject(new Error("A boom"));
  await assert.rejects(pA, /A boom/);

  await tick();
  assert.ok(stats.events.includes("start:B"), "A가 실패해도 B는 실행");
  stats.gates.get("B").resolve();
  assert.equal(await pB, "B");
  assert.equal(mem.processingQueue.size, 0);
});

test("다른 길드는 직렬화되지 않음 — 길드 간 병렬", async () => {
  const { mem, stats } = makeManager();

  const p1 = mem.handleMusicData("g1", { id: "G1" }, null);
  const p2 = mem.handleMusicData("g2", { id: "G2" }, null);

  await tick();
  assert.ok(stats.events.includes("start:G1") && stats.events.includes("start:G2"), "두 길드 모두 즉시 시작");

  stats.gates.get("G2").resolve();
  assert.equal(await p2, "G2", "g1이 진행 중이어도 g2는 완료 가능");
  stats.gates.get("G1").resolve();
  assert.equal(await p1, "G1");
  assert.equal(mem.processingQueue.size, 0);
});
