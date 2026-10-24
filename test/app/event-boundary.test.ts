// src/app/event-boundary.ts — 디스코드 이벤트 처리기를 서버 문맥에서 부르고, 새어 나온 던짐 · 거부를 그 서버의 오류로 넘긴다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { guarded, guildOf } from "../../src/app/event-boundary.ts";
import { currentGuild } from "../../src/infra/guild-context.ts";

const settle = () => new Promise((done) => setImmediate(done));

test("인자에서 서버를 찾는다: guildId(상호작용 · 메시지) · guild.id(음성 상태). 없으면 null", () => {
  assert.equal(guildOf([{ guildId: "g1" }]), "g1");
  assert.equal(guildOf([{ id: "u1" }, { guild: { id: "g2" } }]), "g2");
  assert.equal(guildOf([{ guildId: null }, "문자열", null]), null);
});

test("처리기는 그 서버의 문맥에서 돈다. 던짐 · 거부는 서버와 함께 넘긴다", async () => {
  const faults: string[] = [];
  const onFault = (error: unknown, guildId: string | null, where: string) => faults.push(`${where}:${guildId}:${(error as Error).message}`);
  const seen: Array<string | null> = [];

  guarded("버튼", (_i: { guildId: string }) => void seen.push(currentGuild()), onFault)({ guildId: "g1" });
  guarded(
    "메시지",
    (_m: object) => {
      throw new Error("던짐");
    },
    onFault,
  )({ guildId: "g2" });
  guarded("음성 상태", async (_old: object, _new: object) => Promise.reject(new Error("거부")), onFault)({ guild: { id: "g3" } }, {});
  guarded("준비", async (_c: object) => Promise.reject(new Error("서버 없음")), onFault)({});
  await settle();

  assert.deepEqual(seen, ["g1"]);
  assert.deepEqual(faults, ["메시지:g2:던짐", "음성 상태:g3:거부", "준비:null:서버 없음"]);
});
