// 상호작용 입구 하나. 슬래시 명령은 이름으로 명령 모듈을, 버튼 · 메뉴 · 모달은 종류와 custom_id 앞머리로 처리기를 고른다(interactions/).
// 처리가 던지면 여기서 한 번 남기고 본인에게만 알린다. 본인에게만 보이는 응답의 수명은 이벤트를 거는 조립(app/main)이 건다.

import { Events, MessageFlags, type ChatInputCommandInteraction, type Interaction, type RepliableInteraction } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "events" });
import { isDeadInteraction } from "../src/rules/deadInteraction.ts";
import { messageOf } from "../src/rules/errorKind.ts";
import * as S from "../src/ui/strings.ts";
import { ROUTES } from "../interactions/index.ts";
import { componentOf, routeOf, type Route } from "../interactions/route.ts";
import type { ClientEvent } from "../src/app/main.ts";

const UNKNOWN = "❌ 알 수 없는 상호작용!";
const COMMAND_FAILED = "❌ 명령어 실행 중 오류가 발생했습니다!";

/**
 * 처리가 던졌다. 남기고, 상호작용이 살아 있으면 본인에게만 알린다(이미 답했으면 이어서).
 * 토큰이 죽었으면(10062/40060) 안내 시도가 곧 두 번째 같은 오류라 알리지 않는다
 */
async function failed(interaction: RepliableInteraction, what: string, error: unknown, notice: string) {
  log.error(`${what} 처리 실패:`, error);
  if (isDeadInteraction(error)) return;
  const payload = { content: notice, flags: MessageFlags.Ephemeral } as const;
  const sending = interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
  // 안내 실패는 여기서 끝낸다. 리스너 밖으로 던지면 client "error"를 거쳐 uncaughtException이 된다
  await sending.catch((err: unknown) => log.error("오류 안내 전송 실패:", messageOf(err)));
}

async function runCommand(interaction: ChatInputCommandInteraction) {
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    log.error(`등록되지 않은 명령어: ${interaction.commandName}`);
    return;
  }
  try {
    // 서버 명령은 서버 안에서만. DM 에서도 쓰는 명령은 그대로 부른다
    if (command.anywhere) await command.execute(interaction, interaction.client);
    else if (interaction.inCachedGuild()) await command.execute(interaction, interaction.client);
    else await interaction.reply({ content: "❌ 서버에서만 쓸 수 있는 명령이에요.", flags: MessageFlags.Ephemeral });
  } catch (error) {
    await failed(interaction, `/${interaction.commandName}`, error, COMMAND_FAILED);
  }
}

// 버튼 · 메뉴 · 모달. 서버 안의 것만 받는다
async function runComponent(input: Interaction, routes: readonly Route[]) {
  const component = componentOf(input);
  if (!component) return;
  const { kind, interaction } = component;
  const route = routeOf(routes, kind, interaction.customId);
  if (!route) {
    log.warn(`처리기가 없는 상호작용: ${kind} ${interaction.customId}`);
    return interaction.reply({ content: UNKNOWN, flags: MessageFlags.Ephemeral }).catch((err: unknown) => log.error("오류 안내 전송 실패:", messageOf(err)));
  }
  try {
    await route.handle(interaction);
  } catch (error) {
    await failed(interaction, `${kind} ${interaction.customId}`, error, S.ERR_PROCESSING);
  }
}

/** 상호작용 하나를 맡는다. routes 는 시험이 가짜 표를 넘기는 자리 */
async function route(interaction: Interaction, routes: readonly Route[] = ROUTES) {
  if (interaction.isChatInputCommand()) return runCommand(interaction);
  return runComponent(interaction, routes);
}

const exported: ClientEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  execute: (interaction) => route(interaction),
};
export default exported;
export { route };
