// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// src/player/sessionRestore.ts — 부팅 시 저장 세션의 길드 확보.
//
// 회귀 대상 1: 구 코드는 `guilds.fetch().catch(() => null)`로 거부를 삼켜 바깥 catch의
// `retries--`가 도달 불가였다. 길드 하나가 계속 실패하면 1초 간격 무한 루프 = 부팅 정지.
// 회귀 대상 2: 일시적 조회 실패에도 저장 세션을 삭제했다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RESTJSONErrorCodes } from "discord.js";
import { resolveGuildForRestore } from "../../src/player/sessionRestore.ts";

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

// ── 기동 때 저장 세션 모두 되살리기 ───────────────────────────────────────────

import { after } from "node:test";
const { openTempStore } = (await import("../helpers/tempStore.ts")).default;
const { restoreSavedPlayers } = await import("../../src/player/sessionRestore.ts");
const { sessions } = await import("../../src/store/playerSessions.ts");

const store = openTempStore("session-restore-");
after(() => store.close());

const channel = (id, kind) => ({ id, isVoiceBased: () => kind === "voice", isTextBased: () => kind === "text" });

function saved(guildId, { voice = "vc1", text = "tc1" } = {}) {
  sessions().saveSession(guildId, { voiceChannelId: voice, textChannelId: text });
}

function guildWith(id, chans = [channel("vc1", "voice"), channel("tc1", "text")]) {
  const cache = new Map(chans.map((c) => [c.id, c]));
  return { id, name: `서버 ${id}`, channels: { cache, fetch: async () => null } };
}

// 플레이어 대신. 무엇으로 만들었고 무엇을 불렀는지 남긴다
function fakePlayerClass({ restoreFails = false } = {}) {
  const made = [];
  class FakePlayer {
    constructor(guild, text, voice) {
      Object.assign(this, { guild, text, voice, calls: [] });
      made.push(this);
    }
    async restoreFromState(record) {
      this.calls.push(`restore:${record.guildId}`);
      if (restoreFails) throw new Error("복원 실패");
    }
    cleanup(reason) {
      this.calls.push(`cleanup:${reason}`);
    }
  }
  return { FakePlayer, made };
}

function clientWith(guilds) {
  return { players: new Map(), guilds: { cache: new Map(guilds.map((g) => [g.id, g])), fetch: async () => null } };
}

const remaining = () =>
  sessions()
    .loadAll()
    .map((r) => r.guildId);

test("되살리기: 채널이 멀쩡하면 플레이어를 만들어 등록하고 저장 상태로 되돌린다", async () => {
  saved("r1");
  const client = clientWith([guildWith("r1")]);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSavedPlayers(client, FakePlayer);

  assert.equal(made.length, 1);
  assert.equal(made[0].voice.id, "vc1");
  assert.equal(made[0].text.id, "tc1");
  assert.deepEqual(made[0].calls, ["restore:r1"]);
  assert.equal(client.players.get("r1"), made[0]);
  sessions().removeSession("r1");
});

test("되살리기: 저장 상태를 못 되돌리면 플레이어를 치우고 세션을 지운다", async () => {
  saved("r2");
  const client = clientWith([guildWith("r2")]);
  const { FakePlayer, made } = fakePlayerClass({ restoreFails: true });

  await restoreSavedPlayers(client, FakePlayer);

  assert.deepEqual(made[0].calls, ["restore:r2", "cleanup:세션 복원 실패"]);
  assert.equal(client.players.has("r2"), false);
  assert.deepEqual(remaining(), []);
});

test("되살리기: 채널 기록이 없거나 채널이 음성 · 글자 채널이 아니면 세션을 지운다", async () => {
  saved("r3", { voice: null });
  saved("r4", { voice: "tc1", text: "vc1" }); // 서로 바뀐 종류
  const client = clientWith([guildWith("r3"), guildWith("r4")]);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSavedPlayers(client, FakePlayer);

  assert.equal(made.length, 0);
  assert.deepEqual(remaining(), []);
});

test("되살리기: 서버가 사라졌으면 세션을 지우고, 잠깐 못 받은 것이면 남긴다", async () => {
  saved("gone1");
  saved("flaky1");
  const client = clientWith([]);
  client.guilds.fetch = async (id) => {
    if (id === "gone1") throw Object.assign(new Error("Unknown Guild"), { code: RESTJSONErrorCodes.UnknownGuild });
    throw new Error("네트워크");
  };
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSavedPlayers(client, FakePlayer);

  assert.equal(made.length, 0);
  assert.deepEqual(remaining(), ["flaky1"]);
  sessions().removeSession("flaky1");
});

test("되살리기: 저장 세션이 없으면 아무것도 안 한다", async () => {
  const client = clientWith([]);
  const { FakePlayer, made } = fakePlayerClass();
  await restoreSavedPlayers(client, FakePlayer);
  assert.equal(made.length, 0);
});

test("되살리기: 기다리는 사이 그 서버에서 재생이 시작됐으면 건드리지 않는다", async () => {
  saved("r5");
  const client = clientWith([guildWith("r5")]);
  const live = { live: true };
  client.players.set("r5", live);
  const { FakePlayer, made } = fakePlayerClass();

  await restoreSavedPlayers(client, FakePlayer);

  assert.equal(made.length, 0);
  assert.equal(client.players.get("r5"), live, "지금 도는 플레이어를 바꿔 끼우지 않는다");
  assert.deepEqual(remaining(), ["r5"], "세션 기록도 그 플레이어의 것이다");
  sessions().removeSession("r5");
});
