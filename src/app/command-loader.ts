import type { HelpEntry } from "../ui/help-lines.ts";
import { rule, type RuleProblem } from "../rules/rule-problem.ts";
import { logRuleLine } from "../rules/text/index.ts";
import { REST, RESTJSONErrorCodes, Routes, type AutocompleteInteraction, type ChatInputCommandInteraction, type RESTPostAPIApplicationCommandsJSONBody, type RESTPutAPIApplicationCommandsResult } from "discord.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import config from "../config/index.ts";
import { appIdOf } from "../infra/app-id.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { COMMANDS } from "../discord/commands/index.ts";
import { rememberCommandIds } from "../ui/command-mentions.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { botLanguage } from "../ui/language.ts";
import { textFor } from "../ui/text/index.ts";
import { localizeCommand, type CommandsText } from "../ui/command-localizations.ts";
import type { BotContext } from "./bot-context.ts";
import { PROJECT } from "../infra/project-paths.ts";
import logger from "../infra/log/logger.ts";
import { L } from "../infra/log/text.ts";
const log = logger.child({ category: "core" });

/** 명령 정의. 배포는 JSON으로 */
type CommandData = { toJSON(): RESTPostAPIApplicationCommandsJSONBody };
/** 명령 정의를 만드는 함수. C는 봇 기본 언어의 명령 문구표(locales/<언어>/bot/commands). 다른 언어의 문구는 배포할 때 단다(ui/command-localizations) */
type DefineCommand = (C: CommandsText) => CommandData;
/**
 * 서버 안에서만 쓰는 명령. 호출부(이벤트)가 서버 상호작용인지 먼저 본다. name은 명령 이름(언어마다 같다, 등록과 실행 목록의 키).
 * enabled: 운영자 설정으로 기능을 껐으면 false. 등록에서 빠져 디스코드 명령 목록에 뜨지 않는다(기동 때, 그 설정을 저장할 때의 배포에서)
 * autocomplete: 자동완성을 켠 옵션의 선택지. 3초 안에 respond로 응답한다. 예외를 던지면 호출부(이벤트)가 빈 목록으로 응답한다
 */
type GuildCommand = {
  name: string;
  data: DefineCommand;
  help: HelpEntry | null;
  anywhere?: false;
  enabled?: () => boolean;
  execute(interaction: ChatInputCommandInteraction<"cached">, bot: BotContext): unknown;
  autocomplete?(interaction: AutocompleteInteraction<"cached">, bot: BotContext): Promise<unknown>;
};
/** 서버 밖(DM)에서도 쓰는 명령 */
type AnywhereCommand = { name: string; data: DefineCommand; help: HelpEntry | null; anywhere: true; enabled?: () => boolean; execute(interaction: ChatInputCommandInteraction, bot: BotContext): unknown };
/** 슬래시 명령 모듈. 정의(data)와 실행(execute) */
type SlashCommand = GuildCommand | AnywhereCommand;

// 배포 해시 저장 파일. 정의가 바뀌지 않은 기동에서는 등록 PUT을 건너뛴다
const HASH_PATH = path.join(PROJECT.database, "deployed-commands.json");

/** 켜진 명령. 배포하는 것과 실행 목록에 올리는 것이 이 집합이다(꺼진 기능은 진입점이 없다) */
function enabledCommands() {
  return COMMANDS.filter((command) => command.enabled?.() ?? true);
}

/** 배포용 JSON. 기본값은 봇 기본 언어(C), 다른 언어는 지역화 키로 */
function definitions(C: CommandsText = textFor(botLanguage()).commands) {
  return enabledCommands().map((command) => localizeCommand(command.data(C).toJSON()));
}

/**
 * 배포할 정의가 바뀌면(운영 설정값을 저장해 기능을 켜거나 껐다, 봇 기본 언어를 바꿨다) 실행 목록을 다시 만들고(load) 등록을 맞춘다(deploy). 떼는 함수를 돌려준다.
 * defined: 지금 배포할 정의(테스트가 넘기는 슬롯)
 */
function followEnabledCommands(load: () => void, deploy: () => void, defined: () => unknown = definitions) {
  const shapeOf = () => JSON.stringify(defined());
  let shape = shapeOf();
  return onTunablesChanged(() => {
    const now = shapeOf();
    if (now === shape) return;
    shape = now;
    load();
    deploy();
  });
}

// 명령 정의 + 배포 대상(앱, 범위, 서버)의 해시. 어느 하나라도 바뀌면 재배포한다
function deployFingerprint(scope: string, guildId: string | null, commands: unknown[]) {
  const src = JSON.stringify({ clientId: appIdOf(), scope, guildId, commands });
  return crypto.createHash("sha256").update(src).digest("hex");
}

/** 마지막 배포 기록. guildId는 등록한 서버(전역이면 null, 대상을 적기 전의 파일이면 undefined) */
type Deployed = { fingerprint: string | null; guildId: string | null | undefined };

// 읽지 못하면 재배포한다(안전한 쪽). 파일이 없는 것은 첫 배포라 남기지 않는다
function readDeployed(hashPath: string): Deployed {
  try {
    const saved = JSON.parse(fs.readFileSync(hashPath, "utf8")) as { fingerprint?: string; guildId?: string | null };
    return { fingerprint: saved.fingerprint || null, guildId: saved.guildId === null || typeof saved.guildId === "string" ? saved.guildId : undefined };
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.warn(L.core.commandHashReadFailed({ error: messageOf(error) }));
    return { fingerprint: null, guildId: undefined };
  }
}

// 해시 저장 실패는 다음 기동에서 한 번 더 배포될 뿐이다. 등록 대상(guildId)을 같이 적어 대상이 바뀌면 옛 서버를 비운다
function writeDeployed(hashPath: string, fingerprint: string, guildId: string | null) {
  try {
    fs.mkdirSync(path.dirname(hashPath), { recursive: true });
    fs.writeFileSync(hashPath, JSON.stringify({ fingerprint, guildId, deployedAt: new Date().toISOString() }));
  } catch (error) {
    log.warn(L.core.commandHashSaveFailed({ error: messageOf(error) }));
  }
}

/** 명령 등록 요청. 경로와 정의를 받아 디스코드가 등록한 명령 목록을 돌려준다 */
type PutCommands = (route: `/${string}`, body: RESTPostAPIApplicationCommandsJSONBody[]) => Promise<RESTPutAPIApplicationCommandsResult>;
/** 등록된 명령 목록 읽기(등록을 건너뛴 기동에서 명령 id를 받는다) */
type GetCommands = (route: `/${string}`) => Promise<Array<{ name: string; id: string }>>;
// 디스코드 API의 응답을 등록한 명령 목록으로 본다
const putCommands: PutCommands = async (route, body) => (await new REST().setToken(config.discord.token).put(route, { body })) as RESTPutAPIApplicationCommandsResult;
const getCommands: GetCommands = async (route) => (await new REST().setToken(config.discord.token).get(route)) as Array<{ name: string; id: string }>;

type DeployResult = { ok: true; skipped: boolean; count: number; scope: string; guildId: string | null; names: string[] } | { ok: false; error: unknown; scope: string; guildId: string | null; hint: RuleProblem | null };

// 슬래시 명령을 디스코드에 등록한다. 기동은 정의가 그대로면(해시가 같으면) 건너뛰고, 대시보드의 다시 등록, 수동 스크립트는 force로 늘 등록한다.
// 등록한 명령의 id는 명령 멘션 표(ui/command-mentions)에 둔다. 건너뛰었으면 등록된 목록을 한 번 읽어 온다(못 읽으면 멘션이 글자로 남을 뿐이다).
// hashPath, put, get은 테스트가 넘기는 슬롯(임시 파일이라 운영 해시를 건드리지 않고, 실제로 등록하거나 읽지 않는다)
async function deployCommands({ force = false, hashPath = HASH_PATH, put = putCommands, get = getCommands }: { force?: boolean; hashPath?: string; put?: PutCommands; get?: GetCommands } = {}): Promise<DeployResult> {
  const scope = config.discord.guildId ? "guild" : "global";
  const guildId = config.discord.guildId || null;
  const commands = definitions();
  const fingerprint = deployFingerprint(scope, guildId, commands);
  const route = guildId ? Routes.applicationGuildCommands(appIdOf(), guildId) : Routes.applicationCommands(appIdOf());

  const before = readDeployed(hashPath);
  if (!force && before.fingerprint === fingerprint) {
    // 지문이 같으면 지금 대상에 등록돼 있다. 대상을 적기 전의 파일이면 대상을 채워 둔다(나중에 대상을 바꾸면 옛 서버를 비우게)
    if (before.guildId === undefined) writeDeployed(hashPath, fingerprint, guildId);
    try {
      rememberCommandIds(await get(route), guildId);
    } catch (error) {
      log.warn(L.core.registeredCommandsReadFailed({ error: messageOf(error) }));
    }
    return { ok: true, skipped: true, count: commands.length, scope, guildId, names: commands.map((c) => c.name) };
  }

  try {
    const data = await put(route, commands);
    writeDeployed(hashPath, fingerprint, guildId); // 성공 시에만 기록. 실패하면 다음 기동에 재시도
    rememberCommandIds(data, guildId);
    await tidyOldTarget(before.guildId, guildId, { put, get });
    return { ok: true, skipped: false, count: data.length, scope, guildId, names: data.map((c) => c.name) };
  } catch (error) {
    return { ok: false, error, scope, guildId, hint: deployHint(scope, guildId, error) };
  }
}

/**
 * 등록 대상이 바뀐 뒤의 옛 명령. 디스코드는 전역 명령과 서버 명령을 따로 가져 그 서버에서는 둘 다 보인다.
 * 옛 대상이 서버면 비운다(그 서버만의 것이라 다른 서버에 영향이 없다). 서버에 등록할 때 남은 전역 명령은 지우지 않고 알린다:
 * GUILD_ID를 켠 동안 다른 서버는 그 전역 명령으로 돈다. 지우려면 pnpm commands --clear-global
 */
async function tidyOldTarget(was: string | null | undefined, now: string | null, { put, get }: { put: PutCommands; get: GetCommands }) {
  if (was && was !== now) {
    const cleared = await clearCommands(was, put);
    if (cleared.ok) log.info(L.core.oldGuildCommandsCleared({ guildId: was }));
    else log.warn(L.core.oldGuildCommandsClearFailed({ guildId: was, clearGuildId: was, error: messageOf(cleared.error) }));
  }
  if (!now) return;
  try {
    const left = await get(Routes.applicationCommands(appIdOf()));
    if (left.length) log.warn(L.core.globalCommandsLeft({ count: left.length, guildId: now }));
  } catch (error) {
    log.debug(L.core.globalCommandsReadFailed({ error: messageOf(error) }));
  }
}

/** 등록한 명령을 비운다(빈 목록으로 등록). guildId가 null이면 전역 */
async function clearCommands(guildId: string | null, put: PutCommands = putCommands): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await put(guildId ? Routes.applicationGuildCommands(appIdOf(), guildId) : Routes.applicationCommands(appIdOf()), []);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

// 배포 실패의 원인 안내. 디스코드 오류 코드와 범위로 원인이 하나로 좁혀지는 것만 붙인다(앱 ID는 토큰에서 읽어 틀릴 수 없다).
// 서버 경로의 50001은 봇이 없는 서버와 존재하지 않는 서버 ID를 구분해 주지 않는다. 전역 50001, 50035, 401은 원인을 짐작할 근거가 없다
function deployHint(scope: string, guildId: string | null, error: unknown): RuleProblem | null {
  if (scope === "guild" && codeOf(error) === RESTJSONErrorCodes.MissingAccess) return rule("deploy-guild-missing", guildId ? { guildId } : undefined);
  return null;
}

/** 배포 실패를 로그, 터미널에 남길 줄. 원인 안내(hint)가 있으면 둘째 줄 */
function deployErrorLines(result: { scope: string; error: unknown; hint: RuleProblem | null }) {
  return [L.core.commandDeployScopeFailed({ scope: result.scope, error: messageOf(result.error) }), ...(result.hint ? [logRuleLine(result.hint)] : [])];
}

export { enabledCommands, followEnabledCommands, definitions, deployCommands, clearCommands, deployErrorLines };
export type { SlashCommand, GuildCommand, AnywhereCommand, PutCommands, GetCommands, DeployResult };
