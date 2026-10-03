// src/app/resilience.ts — 프로세스 수준에서 새어 나온 오류. 서버를 알면 그 서버만 다시 켜고, 모르면 남기고 계속 돌며, 서버를 가리지 않고 쏟아질 때만 내린다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { makeFloodGuard, knownDiscordError, fatalShutdown, installErrorHandlers, FLOOD_MAX, FLOOD_WINDOW_MS } from "../../src/app/resilience.ts";
import { inGuild } from "../../src/infra/guild-context.ts";

// ── 빈도 가드 ──

test(`빈도 가드: 시간창 안에 ${FLOOD_MAX}번까지 false, 넘으면 true, 시간창이 지나면 다시 센다`, () => {
  const flooding = makeFloodGuard();
  for (let i = 0; i < FLOOD_MAX; i++) assert.equal(flooding(1000), false);
  assert.equal(flooding(1000), true);
  assert.equal(flooding(1000 + FLOOD_WINDOW_MS + 1), false);
});

test("아는 디스코드 오류: 만료 · 이미 처리된 상호작용은 info, 권한 없음은 error. 그 밖은 null", () => {
  assert.equal(knownDiscordError({ code: 10062 })?.level, "info");
  assert.equal(knownDiscordError({ code: 40060 })?.level, "info");
  assert.equal(knownDiscordError({ code: 50013 })?.level, "error");
  assert.equal(knownDiscordError({ code: 10008 }), null);
  assert.equal(knownDiscordError(new Error("버그")), null);
});

// ── 안전 종료 ──

// 치명 종료로 내릴 플레이어. 세션을 곧바로 쓰고(saveNow) 채널에는 남긴 채 연결을 정리한다(release)
function savable(id: string, steps: string[], { saveFails = false } = {}) {
  return {
    persistence: {
      saveNow: (reason: string) => {
        if (saveFails) throw new Error("디스크 가득 참");
        steps.push(`save:${id}:${reason}`);
      },
    },
    voice: { release: (reason: string) => steps.push(`release:${id}:${reason}`) },
  };
}

test("안전 종료: 모든 플레이어의 세션을 저장하고 채널에는 남긴 채 연결을 정리한 뒤, 전역 폭주로 적고 나간다", () => {
  const steps: string[] = [];
  const players = new Map([
    ["g1", savable("g1", steps)],
    ["g2", null], // 빈 항목도 안전
    ["g3", savable("g3", steps)],
  ]);
  fatalShutdown(players, new Error("fatal"), { exit: () => steps.push("exit"), record: { end: (how) => void steps.push(`record:${how}`) } });
  assert.deepEqual(steps, ["save:g1:shutdown", "release:g1:치명적 오류", "save:g3:shutdown", "release:g3:치명적 오류", "record:global-flood", "exit"]);
});

test("안전 종료: 한 서버의 저장이 실패해도 그 연결은 정리하고, 나머지를 저장하고, 반드시 나간다", () => {
  const steps: string[] = [];
  const players = new Map([
    ["g1", savable("g1", steps, { saveFails: true })],
    ["g2", savable("g2", steps)],
  ]);
  fatalShutdown(players, new Error("fatal"), { exit: () => steps.push("exit"), record: { end: () => {} } });
  assert.deepEqual(steps, ["release:g1:치명적 오류", "save:g2:shutdown", "release:g2:치명적 오류", "exit"]);
});

test("안전 종료: 플레이어 없음도 exit 호출", () => {
  let exited = 0;
  fatalShutdown(null, new Error("fatal"), { exit: () => exited++, record: { end: () => {} } });
  assert.equal(exited, 1);
});

// ── 새어 나온 오류 처리기 ──

// 처리기를 건 클라이언트 · 프로세스. 서버 하나 다시 켜기(faults)와 나가기(exits)를 센다
function installed() {
  const faults: string[] = [];
  const exits: number[] = [];
  const client = new EventEmitter();
  const proc = new EventEmitter();
  installErrorHandlers(client, {
    proc,
    fault: async (guildId, _error, where) => void faults.push(`${guildId}:${where}`),
    exit: () => exits.push(1),
    record: { end: () => {} },
  });
  return { client, proc, faults, exits };
}

test("아는 디스코드 오류는 로그만: 다시 켜지도 내리지도 않고 폭주로 세지 않는다", () => {
  const { client, proc, faults, exits } = installed();
  for (let i = 0; i <= FLOOD_MAX; i++) {
    client.emit("error", { code: 50013, message: "Missing Permissions" });
    proc.emit("unhandledRejection", { code: 10062 });
    inGuild("g1", () => proc.emit("uncaughtException", { code: 40060 }));
  }
  assert.deepEqual(faults, []);
  assert.deepEqual(exits, []);
});

test("서버 문맥 안에서 새어 나온 오류는 그 서버만 다시 켠다. 몇 번이 와도 봇 전체를 내리지 않는다(그 서버의 되풀이는 guildFault 가 막는다)", () => {
  const { proc, faults, exits } = installed();
  for (let i = 0; i <= FLOOD_MAX; i++) inGuild("g1", () => proc.emit("uncaughtException", new Error("버그")));
  inGuild("g2", () => proc.emit("unhandledRejection", new Error("버그")));
  assert.equal(faults.filter((f) => f === "g1:exception").length, FLOOD_MAX + 1);
  assert.ok(faults.includes("g2:rejection"));
  assert.deepEqual(exits, []);
});

test("서버를 모르는 오류는 남기고 계속 돈다. 서버를 가리지 않고 쏟아지면 내린다", () => {
  const { client, proc, faults, exits } = installed();
  proc.emit("uncaughtException", new Error("버그"));
  client.emit("error", Object.assign(new Error("socket"), { code: "ECONNRESET" }));
  assert.deepEqual(exits, [], "한두 번은 계속 돈다");
  for (let i = 0; i < FLOOD_MAX - 1; i++) proc.emit("unhandledRejection", "문자열 거부"); // 앞의 둘과 합쳐 문턱을 한 번 넘는다
  assert.deepEqual(exits, [1], "쏟아지면 내린다");
  assert.deepEqual(faults, []);
});
