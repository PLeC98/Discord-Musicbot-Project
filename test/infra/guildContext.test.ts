// src/infra/guildContext.ts — 서버 문맥이 타이머 · 약속 · await 를 따라가고, 묶은 리스너는 쏜 쪽과 상관없이 그 서버로 돈다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { inGuild, currentGuild, bindToGuild } from "../../src/infra/guildContext.ts";

const tick = () => new Promise((done) => setTimeout(done, 1));

test("문맥 밖이면 null. 문맥 안의 타이머 · await 뒤에도 그 서버다", async () => {
  assert.equal(currentGuild(), null);
  const seen: Array<string | null> = [];
  await inGuild("g1", async () => {
    seen.push(currentGuild());
    await tick();
    seen.push(currentGuild());
    await new Promise<void>((done) =>
      setTimeout(() => {
        seen.push(currentGuild());
        done();
      }, 1),
    );
  });
  assert.deepEqual(seen, ["g1", "g1", "g1"]);
  assert.equal(currentGuild(), null);
});

test("리스너는 쏜 쪽의 문맥에서 불린다. 걸 때 묶으면 쏜 쪽과 상관없이 그 서버다", () => {
  const bus = new EventEmitter();
  const seen: Array<string | null> = [];
  inGuild("g1", () => bus.on("plain", () => seen.push(`plain:${currentGuild()}`)));
  bus.on(
    "bound",
    bindToGuild("g1", () => seen.push(`bound:${currentGuild()}`)),
  );
  inGuild("g2", () => {
    bus.emit("plain");
    bus.emit("bound");
  });
  assert.deepEqual(seen, ["plain:g2", "bound:g1"]);
});
