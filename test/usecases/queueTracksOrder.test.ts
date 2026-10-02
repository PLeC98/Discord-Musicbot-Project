// usecases/addTracks 의 곡 담기(queueTracks)는 서버마다 한 번에 하나다. 앞 작업의 꼬리에 잇는다.
// 틀고 있는 플레이어에 담으면 담은 뒤 응답 매체(notifyQueued)로 알린다. 그 자리를 시험이 붙잡아 끝나는 때를 정한다.
// 회귀 대상: "기다렸다가 등록"하면 앞 작업의 정리가 뒤 작업의 항목을 지워 둘이 함께 돈다

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { queueTracks, type AddResult, type TrackData } from "../../src/usecases/addTracks.ts";
import type { Player } from "../../src/player/Player.ts";
import type { Responder } from "../../src/ui/nowPlayingPanel.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const p = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

// 작업 이름. 첫 곡의 제목에 싣는다
const job = (id: string): TrackData => ({ tracks: [{ id, title: id, pageUrl: "", requestKey: id, platform: "youtube", duration: 0 }] });

// 시험마다 다른 서버 id. 줄은 모듈에 남으므로, 한 시험이 붙잡은 채 실패해도 다음 시험을 막지 않게
let worlds = 0;

// 서버마다 틀고 있는 플레이어. 담기는 진짜로 하고, 알리는 자리에서 붙잡는다
function world(guildIds = ["g1"]) {
  const idOf = (name: string) => `${name}#${worlds}`;
  worlds++;
  const events: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred>>();
  let active = 0;
  let maxActive = 0;
  const players = new Map<string, Player>(guildIds.map((name) => [idOf(name), fakePlayer({ guild: { id: idOf(name) }, currentTrack: { title: "지금" }, queue: [], nowPlayingMessage: null })]));
  const client = fake<Client>({ players, panels: { createQueueAdditionMessage: () => "담음" } });

  // 이 작업을 알리는 매체. 알리는 동안 붙잡는다
  const responder = (id: string): Responder => ({
    async notifyQueued() {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push(`start:${id}`);
      const gate = deferred();
      gates.set(id, gate);
      try {
        await gate.p;
        events.push(`end:${id}`);
      } finally {
        active--;
      }
    },
    async dismissPlaceholder() {},
  });
  const add = (guildName: string, id: string) => queueTracks(client, idOf(guildName), job(id), null, responder(id));
  const playerOf = (guildName: string) => players.get(idOf(guildName));
  const gate = (id: string) => {
    const g = gates.get(id);
    assert.ok(g, `${id} 가 시작했다`);
    return g;
  };
  return { client, players, playerOf, events, add, gate, maxActive: () => maxActive };
}

const tick = () => new Promise((r) => setImmediate(r));
const ok = (r: AddResult) => assert.equal(r.success, true);

test("같은 서버 동시 3건(A/B/C)은 항상 순차 실행", async () => {
  const w = world();

  // 동기적으로 연속 진입 (실사용: 동시 /play + 메시지 추가 + 검색 선택)
  const pA = w.add("g1", "A");
  const pB = w.add("g1", "B");
  const pC = w.add("g1", "C");

  await tick();
  assert.deepEqual(w.events, ["start:A"], "A만 시작. B/C는 대기");
  assert.deepEqual(
    w.playerOf("g1")?.queue.map((t) => t.title),
    ["A"],
    "B/C 는 대기열에도 아직 들어가지 않았다",
  );

  w.gate("A").resolve();
  ok(await pA);
  await tick();
  assert.deepEqual(w.events, ["start:A", "end:A", "start:B"], "A 종료 후에야 B 시작");

  // B 실행 중에 D가 도착한다. A의 정리가 B의 항목을 지웠다면 D는 B와 동시에 돈다
  const pD = w.add("g1", "D");
  await tick();
  assert.ok(!w.events.includes("start:D"), "B 실행 중 도착한 D는 대기");

  w.gate("B").resolve();
  ok(await pB);
  await tick();
  w.gate("C").resolve();
  ok(await pC);
  await tick();
  w.gate("D").resolve();
  ok(await pD);

  assert.equal(w.maxActive(), 1, "동시 실행은 항상 최대 1");
  assert.deepEqual(w.events, ["start:A", "end:A", "start:B", "end:B", "start:C", "end:C", "start:D", "end:D"]);
});

test("앞 작업이 실패해도 뒤 작업은 돈다. 실패는 자기 호출자에게만", async () => {
  const w = world();

  const pA = w.add("g1", "A");
  const pB = w.add("g1", "B");

  await tick();
  w.gate("A").reject(new Error("A boom"));
  assert.deepEqual(await pA, { success: false, code: "add-failed", kind: "unknown-error" });

  await tick();
  assert.ok(w.events.includes("start:B"), "A가 실패해도 B는 실행");
  w.gate("B").resolve();
  ok(await pB);
});

test("앞 작업이 던져도(플레이어를 찾다가) 뒤 작업은 돈다", async () => {
  const w = world();
  const real = w.players.get.bind(w.players);
  let first = true;
  Object.assign(w.players, {
    get: (id: string) => {
      if (first) {
        first = false;
        throw new Error("등록부 고장");
      }
      return real(id);
    },
  });

  const pA = w.add("g1", "A");
  const pB = w.add("g1", "B");
  await assert.rejects(pA, /등록부 고장/);
  await tick();
  assert.deepEqual(w.events, ["start:B"]);
  w.gate("B").resolve();
  ok(await pB);
});

test("다른 서버는 줄 세우지 않는다", async () => {
  const w = world(["g1", "g2"]);

  const p1 = w.add("g1", "G1");
  const p2 = w.add("g2", "G2");

  await tick();
  assert.ok(w.events.includes("start:G1") && w.events.includes("start:G2"), "두 서버 모두 즉시 시작");

  w.gate("G2").resolve();
  ok(await p2);
  w.gate("G1").resolve();
  ok(await p1);
});

test("앞 작업이 끝난 뒤에 온 작업은 기다리지 않고 곧바로 돈다", async () => {
  const w = world();
  const pA = w.add("g1", "A");
  await tick();
  w.gate("A").resolve();
  ok(await pA);

  const pB = w.add("g1", "B");
  await tick();
  assert.deepEqual(w.events, ["start:A", "end:A", "start:B"]);
  w.gate("B").resolve();
  ok(await pB);
});
