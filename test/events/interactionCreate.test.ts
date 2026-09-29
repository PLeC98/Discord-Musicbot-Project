// events/interactionCreate.ts — 상호작용 입구. 슬래시 명령을 찾아 부르고, 버튼 · 메뉴 · 모달은 처리기 표로 고른다.
// 처리가 던지면 한 번 남기고 본인에게만 보이게 알린다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Events, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import interactionCreate, { route as routeInteraction } from "../../events/interactionCreate.ts";
import { route } from "../../interactions/route.ts";
import type { SlashCommand } from "../../src/app/commandLoader.ts";
import { fake, fakeWith } from "../helpers/fake.ts";

type Sent = [string, unknown];

function interaction({ name = "play", chat = true, commands = {} as Record<string, object>, replied = false, guild = true, replyFails = false } = {}) {
  const sent: Sent[] = [];
  const it = fakeWith<ChatInputCommandInteraction>()({
    commandName: name,
    replied,
    deferred: false,
    isChatInputCommand: () => chat,
    inCachedGuild: () => guild,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    reply: async (p: unknown) => {
      if (replyFails) throw new Error("권한 없음");
      sent.push(["reply", p]);
    },
    followUp: async (p: unknown) => sent.push(["followUp", p]),
    client: { commands: new Map(Object.entries(commands).map(([k, c]) => [k, fake<SlashCommand>(c)])) },
  });
  return { it, sent };
}

const failing = (error: Error) => ({
  execute: async () => {
    throw error;
  },
});

test("상호작용 생성 이벤트로 불린다", () => {
  assert.equal(interactionCreate.name, Events.InteractionCreate);
});

test("슬래시 명령도 버튼 · 메뉴 · 모달도 아니면 지나간다", async () => {
  const { it, sent } = interaction({ chat: false });
  await interactionCreate.execute(it);
  assert.deepEqual(sent, []);
});

test("등록되지 않은 명령은 답하지 않는다", async () => {
  const { it, sent } = interaction({ name: "nope" });
  await interactionCreate.execute(it);
  assert.deepEqual(sent, []);
});

test("명령을 상호작용과 클라이언트로 부른다", async () => {
  const seen: unknown[] = [];
  const { it } = interaction({ commands: { play: { execute: async (i: unknown, c: unknown) => seen.push([i, c]) } } });
  await interactionCreate.execute(it);
  assert.deepEqual(seen, [[it, it.client]]);
});

test("서버 밖(DM)에서는 서버 명령을 부르지 않고 그렇다고 알린다", async () => {
  const seen: string[] = [];
  const { it, sent } = interaction({ guild: false, commands: { play: { execute: async () => seen.push("ran") } } });
  await interactionCreate.execute(it);
  assert.deepEqual(seen, []);
  assert.deepEqual(sent, [["reply", { content: "❌ 서버에서만 쓸 수 있는 명령이에요.", flags: 64 }]]);
});

test("DM 에서도 쓰는 명령(anywhere)은 서버 밖에서도 부른다", async () => {
  const seen: string[] = [];
  const { it, sent } = interaction({ name: "ping", guild: false, commands: { ping: { anywhere: true, execute: async () => seen.push("ran") } } });
  await interactionCreate.execute(it);
  assert.deepEqual(seen, ["ran"]);
  assert.deepEqual(sent, []);
});

test("명령이 던지면 본인에게만 보이게 알린다. 이미 답했으면 이어서 보낸다", async () => {
  const fresh = interaction({ commands: { play: failing(new Error("x")) } });
  await interactionCreate.execute(fresh.it);
  assert.deepEqual(fresh.sent, [["reply", { content: "❌ 명령어 실행 중 오류가 발생했습니다!", flags: 64 }]]);

  const answered = interaction({ commands: { play: failing(new Error("x")) }, replied: true });
  await interactionCreate.execute(answered.it);
  assert.equal(answered.sent[0][0], "followUp");
});

test("상호작용이 이미 죽었으면 알리려 하지 않는다", async () => {
  const { it, sent } = interaction({ commands: { play: failing(Object.assign(new Error("Unknown interaction"), { code: 10062 })) } });
  await interactionCreate.execute(it);
  assert.deepEqual(sent, []);
});

test("알리기가 실패해도 던지지 않는다", async () => {
  const { it } = interaction({ commands: { play: failing(new Error("x")) }, replyFails: true });
  await interactionCreate.execute(it);
});

// ── 버튼 · 메뉴 · 모달 ────────────────────────────────────────────────

function press({ customId = "x:1", replied = false, deferred = false, dead = false } = {}) {
  const sent: Sent[] = [];
  const it = fakeWith<ButtonInteraction<"cached">>()({
    customId,
    replied,
    deferred,
    isChatInputCommand: () => false,
    inCachedGuild: () => true,
    isButton: () => true,
    reply: async (p: unknown) => {
      if (dead) throw Object.assign(new Error("Unknown interaction"), { code: 10062 });
      sent.push(["reply", p]);
    },
    followUp: async (p: unknown) => sent.push(["followUp", p]),
  });
  return { it, sent };
}
const throwing = (error: Error) => [
  route("button", "x:", async () => {
    throw error;
  }),
];

test("버튼 처리가 던지면 본인에게만 보이게 알린다. 이미 답했으면 이어서 보낸다", async () => {
  const fresh = press();
  await routeInteraction(fresh.it, throwing(new Error("x")));
  assert.deepEqual(fresh.sent, [["reply", { content: "❌ 처리 중 오류가 발생했습니다!", flags: 64 }]]);

  const answered = press({ deferred: true });
  await routeInteraction(answered.it, throwing(new Error("x")));
  assert.equal(answered.sent[0][0], "followUp");
});

test("버튼 처리가 던졌는데 상호작용이 이미 죽었으면 알리지 않는다", async () => {
  const { it, sent } = press();
  await routeInteraction(it, throwing(Object.assign(new Error("Unknown interaction"), { code: 10062 })));
  assert.deepEqual(sent, []);
});

test("처리기를 찾아 그 상호작용으로 부른다", async () => {
  const seen: unknown[] = [];
  const { it, sent } = press({ customId: "x:go" });
  await routeInteraction(it, [route("button", "x:", (i) => seen.push(i))]);
  assert.deepEqual(seen, [it]);
  assert.deepEqual(sent, []);
});

test("서버 밖의 버튼은 받지 않는다", async () => {
  const seen: unknown[] = [];
  const { it, sent } = press({ customId: "x:go" });
  it.inCachedGuild = (() => false) as never;
  await routeInteraction(it, [route("button", "x:", (i) => seen.push(i))]);
  assert.deepEqual(seen, []);
  assert.deepEqual(sent, []);
});
