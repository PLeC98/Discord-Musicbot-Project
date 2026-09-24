// 슬래시 명령을 시험에서 부른다. 명령은 봇과 같은 로더로 이름을 보고 찾고(처음 부를 때 한 번 읽는다),
// 가짜 상호작용 · 클라이언트는 명령이 읽는 칸만 채운 것을 진짜 타입으로 본다.

import assert from "node:assert/strict";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { loadCommandModules, type SlashCommand } from "../../src/app/commandLoader.ts";
import { fake } from "./fake.ts";

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

export { command, run };
