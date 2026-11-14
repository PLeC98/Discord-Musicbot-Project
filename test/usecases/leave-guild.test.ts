// src/usecases/leave-guild.ts: 봇을 서버에서 내보내는 순서(상주 자리 지우기, 플레이어 정리, 나가기). 나가기 직전의 확인(go)이 던지면 나가지 않는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Guild } from "discord.js";
import { fake } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import * as staySeats from "../../src/store/stay-seats.ts";
import type { PlayerSeats } from "../../src/player/registry.ts";

const store = openTempStore("leave-guild-");
after(() => store.close());
const { leaveGuild } = await import("../../src/usecases/leave-guild.ts");

function setup() {
  const order: string[] = [];
  const guild = fake<Guild>({ id: "g1", leave: async () => void order.push("leave") });
  const player = { dispose: async ({ end, session }: { end: string; session: string }) => void order.push(`dispose:${end}:${session}`) };
  const players = fake<Pick<PlayerSeats, "get">>({ get: () => player });
  return { order, guild, players };
}

test("상주 자리를 지우고, 플레이어를 정리하고(세션도 지운다) 나간다", async () => {
  const { order, guild, players } = setup();
  staySeats.set("g1", "v1", "u1");
  await leaveGuild(players, guild, { reason: "시험", end: "dashboard-leave" });
  assert.deepEqual(order, ["dispose:dashboard-leave:remove", "leave"]);
  assert.equal(staySeats.seatOf("g1"), null);
});

test("정리하는 사이 확인(go, 로그인 세션)이 던지면 나가지 않는다", async () => {
  const { order, guild, players } = setup();
  let calls = 0;
  const ended = new Error("세션 끝남");
  const go = () => {
    if (++calls > 1) throw ended;
  };
  await assert.rejects(leaveGuild(players, guild, { reason: "시험", end: "dashboard-leave", go }), ended);
  assert.deepEqual(order, ["dispose:dashboard-leave:remove"], "정리는 했지만 나가지 않았다");
});
