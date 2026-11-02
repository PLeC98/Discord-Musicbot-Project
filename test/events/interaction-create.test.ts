// src/discord/events/interaction-create.ts: 상호작용 진입점. 슬래시 명령을 찾아 부르고, 버튼, 메뉴, 모달은 핸들러 표로 선택한다.
// 처리가 던지면 한 번 남기고 알린다. 종류를 구분할 수 있는 오류는 그 문장, 자리표시자를 선언한 핸들러는 그 자리표시자에.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Events, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import interactionCreate, { route as routeInteraction } from "../../src/discord/events/interaction-create.ts";
import { route } from "../../src/discord/interactions/route.ts";
import type { SlashCommand } from "../../src/app/command-loader.ts";
import { fake, fakeWith, fakeBot } from "../helpers/fake.ts";
import { networkError } from "../helpers/errors.ts";
import { showFailureWith } from "../../src/ui/failure-notice.ts";
import * as errors from "../../src/ui/text/ko/errors.ts";
import { noticeReply } from "../../src/ui/frame.ts";
import sink from "../../src/infra/log/sink.ts";

type Sent = [string, unknown?];

function interaction({ name = "play", chat = true, commands = {} as Record<string, object>, replied = false, deferred = false, guild = true, replyFails = false } = {}) {
  const sent: Sent[] = [];
  const it = fakeWith<ChatInputCommandInteraction>()({
    commandName: name,
    replied,
    deferred,
    isChatInputCommand: () => chat,
    isAutocomplete: () => false,
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
    editReply: async (p: unknown) => sent.push(["editReply", p]),
    deleteReply: async () => sent.push(["deleteReply"]),
  });
  const bot = fakeBot({ commands: new Map(Object.entries(commands).map(([k, c]) => [k, fake<SlashCommand>(c)])) });
  return { it, sent, bot };
}

const failing = (error: Error) => ({
  execute: async () => {
    throw error;
  },
});

test("상호작용 생성 이벤트로 불린다", () => {
  assert.equal(interactionCreate.name, Events.InteractionCreate);
});

test("슬래시 명령도 버튼, 메뉴, 모달도 아니면 지나간다", async () => {
  const { it, sent, bot } = interaction({ chat: false });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(sent, []);
});

test("실행 목록에 없는 명령(꺼진 기능이 디스코드에 남은 것)은 쓸 수 없다고 본인에게 답한다. 답하지 못해도 던지지 않는다", async () => {
  const { it, sent, bot } = interaction({ name: "nope" });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(sent, [["reply", noticeReply(errors.notice("unknown-command"))]]);
  const failingReply = interaction({ name: "nope", replyFails: true });
  await interactionCreate.execute(failingReply.bot, failingReply.it);
});

test("명령을 상호작용과 봇 문맥으로 부른다", async () => {
  const seen: unknown[] = [];
  const { it, bot } = interaction({ commands: { play: { execute: async (i: unknown, c: unknown) => seen.push([i, c]) } } });
  await interactionCreate.execute(bot, it);
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as unknown[])[0], it);
  assert.equal((seen[0] as unknown[])[1], bot);
});

test("서버 밖(DM)에서는 서버 명령을 부르지 않고 그렇다고 알린다", async () => {
  const seen: string[] = [];
  const { it, sent, bot } = interaction({ guild: false, commands: { play: { execute: async () => seen.push("ran") } } });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(seen, []);
  assert.deepEqual(sent, [["reply", noticeReply(errors.notice("guild-only"))]]);
});

test("DM 에서도 쓰는 명령(anywhere)은 서버 밖에서도 부른다", async () => {
  const seen: string[] = [];
  const { it, sent, bot } = interaction({ name: "ping", guild: false, commands: { ping: { anywhere: true, execute: async () => seen.push("ran") } } });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(seen, ["ran"]);
  assert.deepEqual(sent, []);
});

test("명령이 던지면 본인에게만 보이게 알린다. 이미 답했으면 이어서 보낸다", async () => {
  const fresh = interaction({ commands: { play: failing(new Error("x")) } });
  await interactionCreate.execute(fresh.bot, fresh.it);
  assert.deepEqual(fresh.sent, [["reply", noticeReply(errors.notice("command-failed"))]]);

  const answered = interaction({ commands: { play: failing(new Error("x")) }, replied: true });
  await interactionCreate.execute(answered.bot, answered.it);
  assert.equal(answered.sent[0][0], "followUp");
});

test("미뤄 두고 아직 답하지 않은 명령이 던지면 그 답을 삭제하고 본인에게만 알린다", async () => {
  const { it, sent, bot } = interaction({ commands: { play: failing(new Error("x")) }, deferred: true });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(sent, [["deleteReply"], ["followUp", noticeReply(errors.notice("command-failed"))]]);
});

test("종류를 구분할 수 있는 오류(네트워크 등)는 그 종류의 문장으로 알린다", async () => {
  const { it, sent, bot } = interaction({ commands: { play: failing(networkError()) } });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(sent[0][1], noticeReply(errors.notice("network-error")));

  const pressed = press();
  await routeInteraction(fakeBot(), pressed.it, throwing(networkError()));
  assert.deepEqual(pressed.sent[0][1], noticeReply(errors.notice("network-error")));
});

test("자리표시자를 표시한 핸들러가 선언했으면 그 자리표시자에 알린다", async () => {
  const placeholder = {
    execute: async (i: object) => {
      showFailureWith(i, async (notice) => sent.push(["shown", notice]));
      throw new Error("x");
    },
  };
  const { it, sent, bot } = interaction({ commands: { play: placeholder }, replied: true });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(sent, [["shown", errors.notice("command-failed")]]);

  const pressed = press({ deferred: true });
  await routeInteraction(fakeBot(), pressed.it, [
    route("button", "x:", async (i) => {
      showFailureWith(i, async (notice) => pressed.sent.push(["shown", notice]));
      throw new Error("x");
    }),
  ]);
  assert.deepEqual(pressed.sent, [["shown", errors.notice("processing-failed")]]);
});

test("상호작용이 이미 죽었으면 알리려 하지 않는다", async () => {
  const { it, sent, bot } = interaction({ commands: { play: failing(Object.assign(new Error("Unknown interaction"), { code: 10062 })) } });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(sent, []);
});

test("알리기가 실패해도 던지지 않는다", async () => {
  const { it, bot } = interaction({ commands: { play: failing(new Error("x")) }, replyFails: true });
  await interactionCreate.execute(bot, it);
});

// ── 버튼, 메뉴, 모달 ────────────────────────────────────────────────

function press({ customId = "x:1", replied = false, deferred = false, dead = false } = {}) {
  const sent: Sent[] = [];
  const it = fakeWith<ButtonInteraction<"cached">>()({
    customId,
    replied,
    deferred,
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
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
  await routeInteraction(fakeBot(), fresh.it, throwing(new Error("x")));
  assert.deepEqual(fresh.sent, [["reply", noticeReply(errors.notice("processing-failed"))]]);

  const answered = press({ deferred: true });
  await routeInteraction(fakeBot(), answered.it, throwing(new Error("x")));
  assert.equal(answered.sent[0][0], "followUp");
});

test("버튼 처리가 던졌는데 상호작용이 이미 죽었으면 알리지 않는다", async () => {
  const { it, sent } = press();
  await routeInteraction(fakeBot(), it, throwing(Object.assign(new Error("Unknown interaction"), { code: 10062 })));
  assert.deepEqual(sent, []);
});

test("핸들러를 찾아 그 상호작용으로 부른다", async () => {
  const seen: unknown[] = [];
  const { it, sent } = press({ customId: "x:go" });
  await routeInteraction(fakeBot(), it, [route("button", "x:", (i) => seen.push(i))]);
  assert.deepEqual(seen, [it]);
  assert.deepEqual(sent, []);
});

test("서버 밖의 버튼은 받지 않는다", async () => {
  const seen: unknown[] = [];
  const { it, sent } = press({ customId: "x:go" });
  it.inCachedGuild = (() => false) as never;
  await routeInteraction(fakeBot(), it, [route("button", "x:", (i) => seen.push(i))]);
  assert.deepEqual(seen, []);
  assert.deepEqual(sent, []);
});

// ── 자동완성 ──

/** 자동완성 상호작용. responded 는 respond 를 부르면 참이 된다 */
function suggest({ name = "search", guild = true, commands = {} as Record<string, object> } = {}) {
  const answered: unknown[] = [];
  const it = {
    commandName: name,
    responded: false,
    isChatInputCommand: () => false,
    isAutocomplete: () => true,
    inCachedGuild: () => guild,
    respond: async (choices: unknown) => {
      answered.push(choices);
      it.responded = true;
    },
  };
  const bot = fakeBot({ commands: new Map(Object.entries(commands).map(([k, c]) => [k, fake<SlashCommand>(c)])) });
  return { it: fake<ChatInputCommandInteraction>(it), answered, bot };
}

test("자동완성은 그 명령의 autocomplete 가 답한다", async () => {
  const { it, answered, bot } = suggest({ commands: { search: { autocomplete: async (i: { respond(c: unknown): Promise<void> }) => i.respond([{ name: "a", value: "a" }]) } } });
  await interactionCreate.execute(bot, it);
  assert.deepEqual(answered, [[{ name: "a", value: "a" }]]);
});

test("자동완성 처리가 던지거나 답하지 않았으면 빈 목록으로 답하고, 던짐은 밖으로 새지 않는다", async () => {
  const thrown = suggest({
    commands: {
      search: {
        autocomplete: async () => {
          throw new Error("버그");
        },
      },
    },
  });
  await interactionCreate.execute(thrown.bot, thrown.it);
  assert.deepEqual(thrown.answered, [[]]);

  const silent = suggest({ commands: { search: { autocomplete: async () => {} } } });
  await interactionCreate.execute(silent.bot, silent.it);
  assert.deepEqual(silent.answered, [[]]);
});

test("자동완성이 없는 명령, 없는 명령, 서버 밖은 빈 목록", async () => {
  for (const one of [suggest({ commands: { search: { execute: async () => {} } } }), suggest({ name: "nope" }), suggest({ guild: false, commands: { search: { autocomplete: async () => assert.fail("서버 밖") } } })]) {
    await interactionCreate.execute(one.bot, one.it);
    assert.deepEqual(one.answered, [[]]);
  }
});

// ── 늦게 받은 상호작용 ──

test("만든 뒤 2초가 넘어 받은 상호작용은 warn 으로 남긴다. 1분에 한 줄, 그 사이의 것은 세어 다음 줄에", async () => {
  const from = sink.buffer.length;
  const base = 10_000_000;
  const at = (createdAt: number, now: number) => {
    const { it, bot } = interaction({ commands: { play: { execute: async () => {} } } });
    Object.assign(it, { createdTimestamp: createdAt });
    return routeInteraction(bot, it, [], now);
  };
  await at(base, base + 1999);
  await at(base, base + 3100);
  await at(base + 10_000, base + 13_000);
  await at(base + 70_000, base + 72_500);
  assert.deepEqual(
    sink.buffer
      .slice(from)
      .filter((e) => e.text.startsWith("상호작용 늦게 받음"))
      .map((e) => `${e.level} ${e.text}`),
    ["warn 상호작용 늦게 받음: /play | 생성 뒤 3100ms | 3초 안에 답해야 한다. 늘 이러면 봇 PC 의 시계를 확인", "warn 상호작용 늦게 받음: /play | 생성 뒤 2500ms | 앞서 1번 더 | 3초 안에 답해야 한다. 늘 이러면 봇 PC 의 시계를 확인"],
  );
});
