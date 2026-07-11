"use strict";

// src/resilience.js — 프로세스 오류 복원력 (일시 네트워크=표적 복구 / 치명적=안전 종료)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { VoiceConnectionStatus } = require("@discordjs/voice");
const { isTransientNetworkError, healBrokenPlayers, makeFloodGuard, networkErrorFlooding, unknownRejectionFlooding, fatalShutdown, NET_ERR_MAX } = require("../src/resilience");

// ── isTransientNetworkError ──────────────────────────────────

test("네트워크 오류 분류: code 우선", () => {
  for (const code of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED"]) {
    assert.equal(isTransientNetworkError(Object.assign(new Error("x"), { code })), true, code);
  }
});

test("네트워크 오류 분류: undici UND_ERR_* 접두사", () => {
  assert.equal(isTransientNetworkError(Object.assign(new Error("x"), { code: "UND_ERR_SOCKET" })), true);
  assert.equal(isTransientNetworkError(Object.assign(new Error("x"), { code: "UND_ERR_CONNECT_TIMEOUT" })), true);
});

test("네트워크 오류 분류: name (FetchError/AbortError)", () => {
  assert.equal(isTransientNetworkError(Object.assign(new Error("x"), { name: "FetchError" })), true);
  assert.equal(isTransientNetworkError(Object.assign(new Error("x"), { name: "AbortError" })), true);
});

test("네트워크 오류 분류: message 폴백 (terminated / socket hang up / IP discovery)", () => {
  assert.equal(isTransientNetworkError(new Error("request terminated")), true);
  assert.equal(isTransientNetworkError(new Error("socket hang up")), true);
  assert.equal(isTransientNetworkError(new Error("Cannot perform IP discovery - socket closed")), true);
});

test("무관한 버그는 네트워크로 오인하지 않음 (삼킴 방지)", () => {
  assert.equal(isTransientNetworkError(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(isTransientNetworkError(new Error("something went wrong")), false);
  assert.equal(isTransientNetworkError(Object.assign(new Error("boring"), { code: "SOME_OTHER" })), false);
  assert.equal(isTransientNetworkError(null), false);
  assert.equal(isTransientNetworkError(undefined), false);
});

// ── healBrokenPlayers ────────────────────────────────────────

function fakePlayer({ track = true, paused = false, recovering = false, ready = false, status = null, throwOnRecover = false } = {}) {
  const p = {
    currentTrack: track ? { title: "t" } : null,
    paused,
    isRecovering: recovering,
    connection: { state: { status: status ?? (ready ? VoiceConnectionStatus.Ready : VoiceConnectionStatus.Disconnected) } },
    recovered: 0,
  };
  p.voice = {
    startConnectionRecovery() {
      if (throwOnRecover) throw new Error("recover boom");
      p.recovered++;
    },
  };
  return p;
}

test("표적 복구: 끊긴 플레이어만 복구, 정상·복구중·트랙없음·일시정지·수립중은 무영향", async () => {
  const broken = fakePlayer();
  const ready = fakePlayer({ ready: true });
  const noTrack = fakePlayer({ track: false });
  const pausedP = fakePlayer({ paused: true });
  const recovering = fakePlayer({ recovering: true });
  const connecting = fakePlayer({ status: VoiceConnectionStatus.Connecting });
  const signalling = fakePlayer({ status: VoiceConnectionStatus.Signalling });

  const client = { players: new Map([["g1", broken], ["g2", ready], ["g3", noTrack], ["g4", pausedP], ["g5", recovering], ["g6", connecting], ["g7", signalling]]) };
  await healBrokenPlayers(client);

  assert.equal(broken.recovered, 1, "끊긴 플레이어는 복구");
  assert.equal(ready.recovered, 0, "정상(Ready)은 무영향");
  assert.equal(noTrack.recovered, 0, "트랙 없음은 무영향");
  assert.equal(pausedP.recovered, 0, "일시정지는 무영향");
  assert.equal(recovering.recovered, 0, "자체 복구 중은 방해 금지");
  assert.equal(connecting.recovered, 0, "연결 수립 중(Connecting)은 완료를 기다림");
  assert.equal(signalling.recovered, 0, "연결 수립 중(Signalling)은 완료를 기다림");
});

test("한 플레이어의 복구 실패가 다른 플레이어 복구를 막지 않음", async () => {
  const bad = fakePlayer({ throwOnRecover: true });
  const good = fakePlayer();
  const client = { players: new Map([["g1", bad], ["g2", good]]) };
  await healBrokenPlayers(client);
  assert.equal(good.recovered, 1);
});

test("client 없음/players 없음은 조용히 통과", async () => {
  await healBrokenPlayers(null);
  await healBrokenPlayers({});
});

// ── networkErrorFlooding ─────────────────────────────────────

test(`빈도 가드: 60초 창 내 ${NET_ERR_MAX}회까지 false, 초과 시 true, 창 지나면 리셋`, () => {
  const realNow = Date.now;
  let now = 1_000_000_000;
  Date.now = () => now;
  try {
    for (let i = 1; i <= NET_ERR_MAX; i++) {
      assert.equal(networkErrorFlooding(), false, `${i}번째는 허용`);
    }
    assert.equal(networkErrorFlooding(), true, `${NET_ERR_MAX + 1}번째는 폭주 판정`);
    now += 61_000; // 창 밖으로
    assert.equal(networkErrorFlooding(), false, "창이 지나면 카운터 리셋");
  } finally {
    Date.now = realNow;
  }
});

test("빈도 가드: 인스턴스별 독립 카운터 — 네트워크 폭주가 unknown rejection 판정을 오염시키지 않음", () => {
  const realNow = Date.now;
  let now = 2_000_000_000;
  Date.now = () => now;
  try {
    const a = makeFloodGuard();
    const b = makeFloodGuard();
    for (let i = 1; i <= NET_ERR_MAX; i++) a();
    assert.equal(a(), true, "a는 폭주 판정");
    assert.equal(b(), false, "b의 카운터는 무영향");
  } finally {
    Date.now = realNow;
  }
});

test("빈도 가드: unknownRejectionFlooding 인스턴스 동작 (감사 M-09 — 단발 생존, 반복 시 승격)", () => {
  const realNow = Date.now;
  let now = 3_000_000_000;
  Date.now = () => now;
  try {
    for (let i = 1; i <= NET_ERR_MAX; i++) {
      assert.equal(unknownRejectionFlooding(), false, `${i}번째 단발은 봇 유지`);
    }
    assert.equal(unknownRejectionFlooding(), true, "반복되면 안전 종료 승격");
    now += 61_000;
    assert.equal(unknownRejectionFlooding(), false, "창이 지나면 리셋");
  } finally {
    Date.now = realNow;
  }
});

// ── fatalShutdown ────────────────────────────────────────────

test("안전 종료: 전 플레이어 cleanup + 맵 비움 + 주입된 exit 호출", () => {
  let cleaned = 0;
  let exited = 0;
  const players = new Map([
    ["g1", { cleanup: () => cleaned++ }],
    ["g2", { cleanup: () => cleaned++ }],
    ["g3", null], // cleanup 없는 항목도 안전
  ]);
  fatalShutdown({ players }, new Error("fatal"), () => exited++);
  assert.equal(cleaned, 2);
  assert.equal(players.size, 0);
  assert.equal(exited, 1);
});

test("안전 종료: cleanup이 던져도 exit는 반드시 호출 (best-effort)", () => {
  let exited = 0;
  const players = new Map([["g1", { cleanup: () => { throw new Error("cleanup boom"); } }]]);
  fatalShutdown({ players }, new Error("fatal"), () => exited++);
  assert.equal(exited, 1);
});

test("안전 종료: client 없음도 exit 호출", () => {
  let exited = 0;
  fatalShutdown(null, new Error("fatal"), () => exited++);
  assert.equal(exited, 1);
});
