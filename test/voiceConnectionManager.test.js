"use strict";

// src/VoiceConnectionManager.js — 연결 복구 루프의 단일 실행 계약.
// forceReconnect/resumePlaybackAfterRecovery는 스텁 — 루프 구조(중첩 금지·중단·상한)만 검증.
// 회귀 대상: 구 setInterval(3초) 방식의 콜백 중첩 (forceReconnect 15초 대기와 겹침 — 감사 M-04)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const VoiceConnectionManager = require("../src/VoiceConnectionManager");

function deferred() {
  let resolve, reject;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeVcm({ maxAttempts = 5 } = {}) {
  const player = {
    isRecovering: false,
    recoveryAttempts: 0,
    maxRecoveryAttempts: maxAttempts,
    recoveryInterval: null,
    voiceChannel: { id: "vc1" },
    guild: { channels: { cache: new Map([["vc1", { id: "vc1" }]]) } },
  };
  const vcm = new VoiceConnectionManager(player);
  vcm.recoveryRetryDelayMs = 5; // 테스트용 휴지 단축 (기본 3000ms)

  const stats = { reconnects: 0, activeReconnects: 0, maxActiveReconnects: 0, resumes: 0, saves: 0 };
  let reconnectImpl = async () => false;

  vcm.savePlaybackPosition = () => stats.saves++;
  vcm.resumePlaybackAfterRecovery = async () => stats.resumes++;
  vcm.forceReconnect = async () => {
    stats.reconnects++;
    stats.activeReconnects++;
    stats.maxActiveReconnects = Math.max(stats.maxActiveReconnects, stats.activeReconnects);
    try {
      return await reconnectImpl();
    } finally {
      stats.activeReconnects--;
    }
  };

  return { vcm, player, stats, setReconnect: (fn) => (reconnectImpl = fn) };
}

test("성공 경로: 재연결 성공 → 위치 재개 1회 → 상태 초기화", async () => {
  const { vcm, player, stats, setReconnect } = makeVcm();
  setReconnect(async () => true);

  await vcm.startConnectionRecovery();

  assert.equal(stats.saves, 1, "시작 시 재생 위치 저장");
  assert.equal(stats.reconnects, 1);
  assert.equal(stats.resumes, 1);
  assert.equal(player.isRecovering, false);
  assert.equal(player.recoveryAttempts, 0);
});

test("동시 실행 금지: 느린 재연결 중에도 시도는 항상 1개 이하 (M-04 회귀)", async () => {
  const { vcm, player, stats, setReconnect } = makeVcm();
  const gate = deferred();
  setReconnect(() => gate.p); // 첫 시도가 오래 걸림 (구 코드라면 3초마다 콜백이 겹쳤음)

  const loop = vcm.startConnectionRecovery();
  vcm.startConnectionRecovery(); // 이중 시작은 no-op (isRecovering 가드)
  vcm.startConnectionRecovery();

  await sleep(30); // 구 방식이었다면 이 사이 추가 콜백이 겹칠 시간
  assert.equal(stats.reconnects, 1, "진행 중에는 새 시도가 시작되지 않음");

  gate.resolve(true);
  await loop;
  assert.equal(stats.maxActiveReconnects, 1, "동시 재연결 시도 최대 1");
  assert.equal(stats.resumes, 1);
});

test("실패 반복: 완료를 기다렸다가 휴지 후 재시도, 성공 시 종료", async () => {
  const { vcm, stats, setReconnect } = makeVcm();
  let calls = 0;
  setReconnect(async () => ++calls >= 3); // 두 번 실패 후 성공

  await vcm.startConnectionRecovery();

  assert.equal(stats.reconnects, 3);
  assert.equal(stats.maxActiveReconnects, 1, "재시도끼리도 겹치지 않음");
  assert.equal(stats.resumes, 1);
});

test("상한: maxRecoveryAttempts 초과 시 재개 없이 중단 + 상태 초기화", async () => {
  const { vcm, player, stats, setReconnect } = makeVcm({ maxAttempts: 3 });
  setReconnect(async () => false);

  await vcm.startConnectionRecovery();

  assert.equal(stats.reconnects, 3, "상한만큼만 시도");
  assert.equal(stats.resumes, 0);
  assert.equal(player.isRecovering, false);
});

test("중단: 재연결 대기 중 stop되면 늦은 성공이 상태를 건드리지 않음", async () => {
  const { vcm, player, stats, setReconnect } = makeVcm();
  const gate = deferred();
  setReconnect(() => gate.p);

  const loop = vcm.startConnectionRecovery();
  await tick();
  vcm.stopConnectionRecovery(); // 대기 중 중단 (예: cleanup/새 연결 성립)
  assert.equal(player.isRecovering, false);

  gate.resolve(true); // 늦게 성공 복귀 — 이미 무효화된 세대
  await loop;
  assert.equal(stats.resumes, 0, "무효화된 루프는 재개를 실행하지 않음");
  assert.equal(player.isRecovering, false);
});

test("음성 채널이 사라졌으면 재연결 시도 없이 종료", async () => {
  const { vcm, player, stats } = makeVcm();
  player.guild.channels.cache.clear();

  await vcm.startConnectionRecovery();

  assert.equal(stats.reconnects, 0);
  assert.equal(player.isRecovering, false);
});

test("forceReconnect가 던져도 루프는 reject 없이 재시도 후 정상 종료", async () => {
  const { vcm, player, stats, setReconnect } = makeVcm({ maxAttempts: 2 });
  setReconnect(async () => {
    throw new Error("reconnect boom");
  });

  await vcm.startConnectionRecovery(); // reject되면 테스트 자체가 실패

  assert.equal(stats.reconnects, 2);
  assert.equal(player.isRecovering, false);
});
