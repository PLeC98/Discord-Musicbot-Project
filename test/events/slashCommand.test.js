// events/slashCommand.js — 슬래시 명령을 찾아 부르고, 실패하면 본인에게만 보이게 알린다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Events } from "discord.js";
import slashCommand from "../../events/slashCommand.ts";

function interaction({ name = "play", chat = true, commands = {}, replied = false } = {}) {
  const sent = [];
  const it = {
    commandName: name,
    replied,
    deferred: false,
    isChatInputCommand: () => chat,
    reply: async (p) => sent.push(["reply", p]),
    followUp: async (p) => sent.push(["followUp", p]),
    client: { commands: new Map(Object.entries(commands)) },
  };
  return { it, sent };
}

const failing = (error) => ({
  execute: async () => {
    throw error;
  },
});

test("상호작용 생성 이벤트로 불린다", () => {
  assert.equal(slashCommand.name, Events.InteractionCreate);
});

test("슬래시 명령이 아니면 지나간다", async () => {
  const { it, sent } = interaction({ chat: false });
  await slashCommand.execute(it);
  assert.deepEqual(sent, []);
});

test("등록되지 않은 명령은 답하지 않는다", async () => {
  const { it, sent } = interaction({ name: "nope" });
  await slashCommand.execute(it);
  assert.deepEqual(sent, []);
});

test("명령을 상호작용과 클라이언트로 부른다", async () => {
  const seen = [];
  const { it } = interaction({ commands: { play: { execute: async (i, c) => seen.push([i, c]) } } });
  await slashCommand.execute(it);
  assert.deepEqual(seen, [[it, it.client]]);
});

test("명령이 던지면 본인에게만 보이게 알린다. 이미 답했으면 이어서 보낸다", async () => {
  const fresh = interaction({ commands: { play: failing(new Error("x")) } });
  await slashCommand.execute(fresh.it);
  assert.deepEqual(fresh.sent, [["reply", { content: "❌ 명령어 실행 중 오류가 발생했습니다!", flags: [1 << 6] }]]);

  const answered = interaction({ commands: { play: failing(new Error("x")) }, replied: true });
  await slashCommand.execute(answered.it);
  assert.equal(answered.sent[0][0], "followUp");
});

test("상호작용이 이미 죽었으면 알리려 하지 않는다", async () => {
  const { it, sent } = interaction({ commands: { play: failing(Object.assign(new Error("Unknown interaction"), { code: 10062 })) } });
  await slashCommand.execute(it);
  assert.deepEqual(sent, []);
});

test("알리기가 실패해도 던지지 않는다", async () => {
  const { it } = interaction({ commands: { play: failing(new Error("x")) } });
  it.reply = async () => {
    throw new Error("권한 없음");
  };
  await slashCommand.execute(it);
});
