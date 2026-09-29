// 슬래시 명령을 시험에서 부른다. 명령은 봇과 같은 로더로 이름을 보고 찾고(처음 부를 때 한 번 읽는다),
// 가짜 상호작용 · 클라이언트는 명령이 읽는 칸만 채운 것을 진짜 타입으로 본다.

import assert from "node:assert/strict";
import type { ChatInputCommandInteraction, Client, Interaction } from "discord.js";
import { loadCommandModules, type SlashCommand } from "../../src/app/commandLoader.ts";
import { fake } from "./fake.ts";
import { interactionKind } from "./interactionKind.ts";

let loading: Promise<Map<string, SlashCommand>> | null = null;

/** 이름으로 명령 하나 */
async function command(name: string) {
  loading ??= loadCommandModules().then(({ commands }) => new Map(commands.map(({ command: c }) => [c.data.name, c])));
  const found = (await loading).get(name);
  assert.ok(found, `/${name} 명령이 있다`);
  return found;
}

/** 명령을 가짜 상호작용 · 클라이언트로 부른다 */
function run(c: SlashCommand, interaction: object, client: object = {}) {
  return c.execute(fake<ChatInputCommandInteraction<"cached">>(interaction), fake<Client<true>>(client));
}

/**
 * 명령을 상호작용 입구(events/interactionCreate)로 부른다. 명령이 던진 것을 입구가 남기고 알리는 모습을 볼 때.
 * 가짜 상호작용 · 클라이언트에 입구가 읽는 칸(종류 · 명령 이름 · 명령 목록)을 채운다
 */
async function runViaEntrance(c: SlashCommand, interaction: object, client: object) {
  const { default: entrance } = await import("../../events/interactionCreate.ts");
  Object.assign(client, { commands: new Map([[c.data.name, c]]) });
  Object.assign(interaction, interactionKind("command"), { commandName: c.data.name, client });
  await entrance.execute(fake<Interaction>(interaction));
}

export { command, run, runViaEntrance };
