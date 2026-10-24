// 슬래시 명령을 테스트에서 부른다. 명령은 봇과 같은 목록(src/discord/commands/index)에서 이름으로 찾고(처음 부를 때 한 번 불러온다),
// 가짜 상호작용 · 봇 문맥은 명령이 읽는 필드만 채운 것을 진짜 타입으로 본다.

import assert from "node:assert/strict";
import type { ChatInputCommandInteraction, Interaction } from "discord.js";
import type { BotContext } from "../../src/app/bot-context.ts";
import type { SlashCommand } from "../../src/app/command-loader.ts";
import { fake, fakeBot } from "./fake.ts";
import { interactionKind } from "./interaction-kind.ts";

let loading: Promise<Map<string, SlashCommand>> | null = null;

/** 이름으로 명령 하나 */
async function command(name: string) {
  loading ??= import("../../src/discord/commands/index.ts").then(({ COMMANDS }) => new Map(COMMANDS.map((c) => [c.data.name, c])));
  const found = (await loading).get(name);
  assert.ok(found, `/${name} 명령이 있다`);
  return found;
}

/** 명령을 가짜 상호작용 · 봇 문맥으로 부른다. 종류 메서드(isChatInputCommand 등)는 테스트가 정하지 않았으면 명령 것으로 채운다 */
function run(c: SlashCommand, interaction: object, bot: BotContext = fakeBot()) {
  for (const [key, value] of Object.entries(interactionKind("command"))) if (!(key in interaction)) Object.assign(interaction, { [key]: value });
  return c.execute(fake<ChatInputCommandInteraction<"cached">>(interaction), bot);
}

/**
 * 명령을 상호작용 진입점(src/discord/events/interaction-create)으로 부른다. 명령이 던진 것을 진입점이 남기고 알리는 모습을 볼 때.
 * 가짜 상호작용에 진입점이 읽는 필드(종류 · 명령 이름)을, 봇 문맥의 명령 목록에 이 명령을 채운다
 */
async function runViaEntrance(c: SlashCommand, interaction: object, bot: BotContext = fakeBot()) {
  const { default: entrance } = await import("../../src/discord/events/interaction-create.ts");
  Object.assign(interaction, interactionKind("command"), { commandName: c.data.name });
  await entrance.execute({ ...bot, commands: new Map([[c.data.name, c]]) }, fake<Interaction>(interaction));
}

export { command, run, runViaEntrance };
