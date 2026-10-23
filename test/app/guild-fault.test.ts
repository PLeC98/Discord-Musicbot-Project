// src/app/guild-fault.ts — 모르는 오류가 난 서버만 다시 시작한다(세션 저장 → 채널에 남긴 채 버리기 → 복원). 되풀이되면 그 서버만 멈춘다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuildFaults, MAX_RESETS, WINDOW_MS } from "../../src/app/guild-fault.ts";
import { fakePlayer } from "../helpers/fake.ts";

type Players = Parameters<typeof createGuildFaults>[0]["players"];

// 레지스트리와 플레이어 가짜. 테스트는 steps 로 무엇을 불렀는지 본다
function world({ track = true } = {}) {
  const steps: string[] = [];
  const player = {
    currentTrack: track ? { title: "곡" } : null,
    queue: [] as unknown[],
    async dispose(o: { session: string; stay?: boolean; panel?: string; end?: string }) {
      steps.push(`dispose:${o.session}:${o.stay ? "stay" : "leave"}:${o.panel ?? "-"}:${o.end}`);
    },
  };
  const players: Players = new Map([["g1", fakePlayer(player)]]);
  const clock = { now: 1_000_000 };
  const fault = createGuildFaults({ players, restore: async (id) => void steps.push(`restore:${id}`), now: () => clock.now });
  return { steps, players, clock, fault };
}

test("곡이 있으면 세션을 저장하고 채널에 남긴 채 버린 뒤 그 서버만 복원한다", async () => {
  const { steps, fault } = world();
  await fault("g1", new Error("버그"), "시험");
  assert.deepEqual(steps, ["dispose:save:stay:-:fault", "restore:g1"]);
});

test("디스코드가 권한 없음으로 거절한 것은 다시 시작하지 않고 되풀이로도 세지 않는다", async () => {
  const { steps, fault } = world();
  const refused = Object.assign(new Error("Missing Permissions"), { code: 50013, url: "https://discord.com/api/v10/channels/1/messages" });
  for (let i = 0; i <= MAX_RESETS; i++) await fault("g1", refused, "시험");
  assert.deepEqual(steps, []);
  await fault("g1", new Error("버그"), "시험");
  assert.deepEqual(steps, ["dispose:save:stay:-:fault", "restore:g1"]);
});

test("플레이어가 없으면(명령 · 화면 쪽) 로그만. 지킬 곡이 없으면 평소처럼 버린다", async () => {
  const none = world();
  await none.fault("g9", new Error("버그"), "시험");
  assert.deepEqual(none.steps, []);

  const idle = world({ track: false });
  await idle.fault("g1", new Error("버그"), "시험");
  assert.deepEqual(idle.steps, ["dispose:remove:leave:-:fault"]);
});

test(`같은 서버에서 ${WINDOW_MS / 60_000}분 안에 ${MAX_RESETS}번을 넘으면 세션을 삭제하고 그 서버만 멈춘다. 시간이 지나면 다시 센다`, async () => {
  const { steps, fault, clock } = world();
  for (let i = 0; i < MAX_RESETS; i++) await fault("g1", new Error("버그"), "시험");
  steps.length = 0;
  await fault("g1", new Error("버그"), "시험");
  assert.deepEqual(steps, ["dispose:remove:leave:stop:fault"]);

  steps.length = 0;
  clock.now += WINDOW_MS;
  await fault("g1", new Error("버그"), "시험");
  assert.deepEqual(steps, ["dispose:save:stay:-:fault", "restore:g1"]);
});

test("다시 시작하는 중에 같은 서버에서 난 오류는 그 다시 시작이 맡는다", async () => {
  const steps: string[] = [];
  const releases: Array<() => void> = [];
  const player = {
    currentTrack: { title: "곡" },
    queue: [],
    dispose: async () => {
      steps.push("dispose");
      await new Promise<void>((done) => releases.push(done));
    },
  };
  const fault = createGuildFaults({ players: new Map([["g1", fakePlayer(player)]]), restore: async () => void steps.push("restore") });
  const both = [fault("g1", new Error("하나"), "시험"), fault("g1", new Error("둘"), "시험")];
  await new Promise((done) => setImmediate(done));
  for (const release of releases) release();
  await Promise.all(both);
  assert.deepEqual(steps, ["dispose", "restore"]);
});
