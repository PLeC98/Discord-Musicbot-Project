// 상호작용 입구 하나. 슬래시 명령은 이름으로 명령 모듈을, 버튼 · 메뉴 · 모달은 종류와 custom_id 앞머리로 처리기를 고른다(interactions/).
// 처리가 던지면 여기서 한 번 남기고 알린다(명령 · 처리기는 제 catch 를 두지 않는다). 응답의 대상 · 수명은 ui/delivery 가 정한다.

import { Events, type ChatInputCommandInteraction, type Interaction, type RepliableInteraction } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import { isDeadInteraction } from "../../rules/dead-interaction.ts";
import { errorKind, messageOf } from "../../rules/error-kind.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import type { Notice } from "../../ui/text/notice.ts";
import { errorMessage } from "../../ui/error-messages.ts";
import { failureShow } from "../../ui/failure-notice.ts";
import { noticeSelf } from "../../ui/delivery.ts";
import { ROUTES } from "../interactions/index.ts";
import { componentOf, routeOf, type Route } from "../interactions/route.ts";
import type { ClientEvent } from "../../app/main.ts";

/**
 * 처리가 던졌다. 종류와 함께 남기고, 상호작용이 살아 있으면 알린다. 종류를 가를 수 있는 오류(네트워크 · 봇 감지 등)는
 * 그 문장으로, 아니면 fallback. 자리표시자를 띄운 처리기가 선언했으면 그 자리에(ui/failure-notice), 미뤄 둔 명령이면
 * 그 답 자리에, 아니면 본인에게만(이미 답했으면 이어서).
 * 토큰이 죽었으면(10062/40060) 안내 시도가 곧 두 번째 같은 오류라 알리지 않는다
 */
async function failed(interaction: RepliableInteraction, what: string, error: unknown, fallback: Notice) {
  const kind = errorKind(error);
  log.error({ kind }, `${what} 처리 실패:`, error);
  if (isDeadInteraction(error)) return;
  const notice = kind === "unknown-error" ? fallback : errorMessage(error);
  // 안내 실패는 여기서 끝낸다. 리스너 밖으로 던지면 client "error"를 거쳐 uncaughtException이 된다
  await tell(interaction, notice).catch((err: unknown) => log.error("오류 안내 전송 실패:", messageOf(err)));
}

function tell(interaction: RepliableInteraction, notice: Notice): Promise<unknown> {
  const show = failureShow(interaction);
  if (show) return show(notice);
  // 미뤄 둔 명령은 그 자리를 지우고, 이미 답했으면 후속 메시지로
  return noticeSelf(interaction, notice);
}

async function runCommand(interaction: ChatInputCommandInteraction) {
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    log.warn(`실행 목록에 없는 명령: /${interaction.commandName}`);
    return noticeSelf(interaction, errors.notice("unknown-command")).catch((err: unknown) => log.error("오류 안내 전송 실패:", messageOf(err)));
  }
  try {
    // 서버 명령은 서버 안에서만. DM 에서도 쓰는 명령은 그대로 부른다
    if (command.anywhere) await command.execute(interaction, interaction.client);
    else if (interaction.inCachedGuild()) await command.execute(interaction, interaction.client);
    else await noticeSelf(interaction, errors.notice("guild-only"));
  } catch (error) {
    await failed(interaction, `/${interaction.commandName}`, error, errors.notice("command-failed"));
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
    return noticeSelf(interaction, errors.notice("unknown-interaction")).catch((err: unknown) => log.error("오류 안내 전송 실패:", messageOf(err)));
  }
  try {
    await route.handle(interaction);
  } catch (error) {
    await failed(interaction, `${kind} ${interaction.customId}`, error, errors.notice("processing-failed"));
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
