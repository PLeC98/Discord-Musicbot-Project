"use strict";

// src/sessionRestore.js — 부팅 시 저장 세션의 길드 확보.
//
// 회귀 대상 1: 구 코드는 `guilds.fetch().catch(() => null)`로 거부를 삼켜 바깥 catch의
// `retries--`가 도달 불가였다. 길드 하나가 계속 실패하면 1초 간격 무한 루프 = 부팅 정지.
// 회귀 대상 2: 일시적 조회 실패에도 저장 세션을 삭제했다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RESTJSONErrorCodes } = require("discord.js");
const { resolveGuildForRestore } = require("../src/sessionRestore");

// 재시도 대기는 0으로 — 검증 대상은 시도 횟수지 대기 시간이 아니다
const NOW = { attempts: 3, delayMs: 0 };

function makeClient(fetchImpl, cache = new Map()) {
  const calls = [];
  return {
    calls,
    guilds: {
      cache,
      fetch: async (id) => {
        calls.push(id);
        return fetchImpl(calls.length);
      },
    },
  };
}

function apiError(code) {
  return Object.assign(new Error(`api ${code}`), { code });
}

test("fetch가 계속 실패해도 정확히 N회 뒤 종료한다 (무한 루프 회귀)", { timeout: 3000 }, async () => {
  const client = makeClient(() => {
    throw new Error("ECONNRESET");
  });

  const res = await resolveGuildForRestore(client, "g1", NOW);

  assert.equal(client.calls.length, 3, "시도 횟수가 반복마다 반드시 증가해야 한다");
  assert.equal(res.guild, null);
  assert.equal(res.gone, false, "일시적 실패는 '길드 없음'이 아니다");
});

test("fetch가 null을 돌려줘도 무한히 돌지 않는다", { timeout: 3000 }, async () => {
  const client = makeClient(() => null);
  const res = await resolveGuildForRestore(client, "g1", NOW);

  assert.equal(client.calls.length, 3);
  assert.equal(res.guild, null);
  assert.equal(res.gone, false);
});

test("길드가 실제로 사라졌을 때만 gone — 재시도 없이 즉시", async () => {
  for (const code of [RESTJSONErrorCodes.UnknownGuild, RESTJSONErrorCodes.MissingAccess]) {
    const client = makeClient(() => {
      throw apiError(code);
    });

    const res = await resolveGuildForRestore(client, "g1", NOW);
    assert.equal(res.gone, true, `code ${code}`);
    assert.equal(client.calls.length, 1, "확답을 받았으면 더 두드릴 이유가 없다");
  }
});

test("네트워크·레이트리밋 실패는 세션을 지우지 않는다", async () => {
  for (const err of [new Error("getaddrinfo ENOTFOUND"), Object.assign(new Error("429 Too Many Requests"), { status: 429 }), Object.assign(new Error("500 Internal Server Error"), { status: 500 })]) {
    const client = makeClient(() => {
      throw err;
    });
    assert.equal((await resolveGuildForRestore(client, "g1", NOW)).gone, false, err.message);
  }
});

test("재시도 중 성공하면 그 길드를 돌려준다", async () => {
  const guild = { id: "g1", name: "복구됨" };
  const client = makeClient((n) => {
    if (n < 3) throw new Error("일시적");
    return guild;
  });

  const res = await resolveGuildForRestore(client, "g1", NOW);
  assert.equal(res.guild, guild);
  assert.equal(client.calls.length, 3);
});

test("캐시에 있으면 REST를 부르지 않는다", async () => {
  const guild = { id: "g1" };
  const client = makeClient(
    () => {
      throw new Error("불려서는 안 된다");
    },
    new Map([["g1", guild]]),
  );

  const res = await resolveGuildForRestore(client, "g1", NOW);
  assert.equal(res.guild, guild);
  assert.equal(client.calls.length, 0);
});
