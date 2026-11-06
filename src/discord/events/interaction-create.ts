// 상호작용 진입점 하나. 슬래시 명령과 그 자동완성은 이름으로 명령 모듈을, 버튼, 메뉴, 모달은 종류와 custom_id 접두사로 핸들러를 선택한다(discord/interactions/).
// 처리가 던지면 여기서 한 번 남기고 알린다(명령, 핸들러는 제 catch 를 두지 않는다). 응답의 대상, 수명은 ui/delivery 가 정한다.

import { Events, type AutocompleteInteraction, type ChatInputCommandInteraction, type Interaction, type RepliableInteraction } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import { isDeadInteraction } from "../../rules/dead-interaction.ts";
import { describeError, errorKind, messageOf } from "../../rules/error-kind.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import type { Notice } from "../../ui/text/notice.ts";
import { errorMessage } from "../../ui/error-messages.ts";
import { failureShow } from "../../ui/failure-notice.ts";
import { noticeSelf } from "../../ui/delivery.ts";
import { isServerManager } from "../../usecases/permissions.ts";
import { ROUTES } from "../interactions/index.ts";
import { componentOf, routeOf, type Route } from "../interactions/route.ts";
import type { ClientEvent } from "../../app/main.ts";
import type { BotContext } from "../../app/bot-context.ts";

/**
 * 처리가 던졌다. 종류와 함께 남기고, 상호작용이 살아 있으면 알린다. 종류를 구분할 수 있는 오류(네트워크, 봇 감지 등)는
 * 그 문장으로, 아니면 fallback. 자리표시자를 표시한 핸들러가 선언했으면 그 자리표시자에(ui/failure-notice), 미뤄 둔 명령이면
 * 그 답 메시지에, 아니면 본인에게만(이미 답했으면 이어서).
 * 토큰이 죽었거나(10062) 이미 답한 곳이 있으면(40060) 알리지 않는다(rules/dead-interaction)
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
  // 미뤄 둔 명령은 그 답 메시지를 삭제하고, 이미 답했으면 후속 메시지로
  return noticeSelf(interaction, notice);
}

async function runCommand(bot: BotContext, interaction: ChatInputCommandInteraction) {
  const command = bot.commands.get(interaction.commandName);
  if (!command) {
    log.warn(`처리할 핸들러가 없는 명령어: /${interaction.commandName}`);
    return noticeSelf(interaction, errors.notice("unknown-command")).catch((err: unknown) => log.error("오류 안내 전송 실패:", messageOf(err)));
  }
  try {
    // 서버 명령은 서버 안에서만. DM 에서도 쓰는 명령은 그대로 부른다
    if (command.anywhere) await command.execute(interaction, bot);
    else if (!interaction.inCachedGuild()) await noticeSelf(interaction, errors.notice("guild-only"));
    // 서버 관리 계층(도움말의 표시)은 디스코드 기본 권한에 기대지 않고 다시 본다: 연동 탭에서 다른 역할에 열어 줄 수 있고, 설정 패널 단추와 대시보드도 이것을 본다
    else if (command.help?.tier === "server-manager" && !isServerManager(interaction.member)) await noticeSelf(interaction, errors.notice("must-server-manager"));
    else await command.execute(interaction, bot);
  } catch (error) {
    await failed(interaction, `/${interaction.commandName}`, error, errors.notice("command-failed"));
  }
}

// 자동완성. 답할 메시지가 없어 실패를 알릴 곳이 없으니, 무엇이 던져도 빈 목록으로 답해 둔다(처리 경계로 새면 그 서버의 오류로 센다).
// 서버 밖(DM)이나 자동완성이 없는 명령도 빈 목록
async function runAutocomplete(bot: BotContext, interaction: AutocompleteInteraction) {
  const command = bot.commands.get(interaction.commandName);
  try {
    if (command && !command.anywhere && command.autocomplete && interaction.inCachedGuild()) await command.autocomplete(interaction, bot);
  } catch (error) {
    // 마감(3초)을 넘겨 토큰이 죽었거나 이미 답했다. 봇 쪽 사정이라 남기되, 입력할 때마다 오므로 묶는다
    if (isDeadInteraction(error)) {
      const now = Date.now();
      lateAnswer(now, (more) => `자동완성 답 실패(늦음): /${interaction.commandName} | 생성 뒤 ${now - interaction.createdTimestamp}ms${more} | ${describeError(error)}`);
    } else log.error(`/${interaction.commandName} 자동완성 처리 실패:`, error);
  }
  if (!interaction.responded) await interaction.respond([]).catch((error: unknown) => log.debug(`자동완성 빈 답 실패: ${describeError(error)}`));
}

// 버튼, 메뉴, 모달. 서버 안의 것만 받는다
async function runComponent(bot: BotContext, input: Interaction, routes: readonly Route[]) {
  const component = componentOf(input);
  if (!component) return;
  const { kind, interaction } = component;
  const route = routeOf(routes, kind, interaction.customId);
  if (!route) {
    log.warn(`핸들러가 없는 상호작용: ${kind} ${interaction.customId}`);
    return noticeSelf(interaction, errors.notice("unknown-interaction")).catch((err: unknown) => log.error("오류 안내 전송 실패:", messageOf(err)));
  }
  try {
    await route.handle(interaction, bot);
  } catch (error) {
    await failed(interaction, `${kind} ${interaction.customId}`, error, errors.notice("processing-failed"));
  }
}

/** 받았을 때 상호작용이 만들어진 뒤 이만큼 지났으면 남긴다(ms). 디스코드는 3초 안에 답해야 받는다 */
const LATE_MS = 2000;
/** 늦게 받은 것, 늦게 답한 것을 남기는 간격(ms). 봇 PC 의 시계가 어긋나 있으면 상호작용마다 늦게 보인다 */
const LATE_LOG_EVERY_MS = 60_000;

// warn 을 LATE_LOG_EVERY_MS 에 한 줄로. 그 사이의 것은 세어 다음 줄에 " | 앞서 N번 더" 로 붙인다
function oncePerInterval() {
  const state = { loggedAt: -Infinity, skipped: 0 };
  return (now: number, line: (more: string) => string) => {
    if (now - state.loggedAt < LATE_LOG_EVERY_MS) {
      state.skipped++;
      return;
    }
    log.warn(line(state.skipped ? ` | 앞서 ${state.skipped}번 더` : ""));
    state.loggedAt = now;
    state.skipped = 0;
  };
}
const lateReceive = oncePerInterval();
const lateAnswer = oncePerInterval();

const nameOf = (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isAutocomplete()) return `/${interaction.commandName} 자동완성`;
  return "customId" in interaction ? String(interaction.customId) : "상호작용";
};

// 늦게 받은 상호작용. 답하지 못한 것(10062)이 받기 전에 늦었는지(디스코드, 네트워크, 봇이 바빴음) 답하다 늦었는지 가르려고 받은 때의 나이를 남긴다
function noteLate(interaction: Interaction, now: number) {
  const age = now - interaction.createdTimestamp;
  if (!Number.isFinite(age) || age < LATE_MS) return;
  lateReceive(now, (more) => `상호작용 늦게 받음: ${nameOf(interaction)} | 생성 뒤 ${age}ms${more} | 늘 이러면 봇 PC 의 시계를 확인하세요`);
}

/** 상호작용 하나를 맡는다. routes 는 테스트가 가짜 표를 넘기는 슬롯, now 는 받은 시각 */
async function route(bot: BotContext, interaction: Interaction, routes: readonly Route[] = ROUTES, now = Date.now()) {
  noteLate(interaction, now);
  if (interaction.isChatInputCommand()) return runCommand(bot, interaction);
  if (interaction.isAutocomplete()) return runAutocomplete(bot, interaction);
  return runComponent(bot, interaction, routes);
}

const exported: ClientEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  execute: (bot, interaction) => route(bot, interaction),
};
export default exported;
export { route };
