import type { HelpEntry } from "../ui/help-lines.ts";
import { REST, RESTJSONErrorCodes, Routes, type AutocompleteInteraction, type ChatInputCommandInteraction, type RESTPostAPIApplicationCommandsJSONBody, type RESTPutAPIApplicationCommandsResult } from "discord.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import config from "../config/index.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { COMMANDS } from "../discord/commands/index.ts";
import { rememberCommandIds } from "../ui/command-mentions.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import type { BotContext } from "./bot-context.ts";
import { PROJECT } from "../infra/project-paths.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });

/** 명령 정의. 배포는 JSON으로, 등록은 이름으로 */
type CommandData = { name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
/**
 * 서버 안에서만 쓰는 명령. 호출부(이벤트)가 서버 상호작용인지 먼저 본다.
 * enabled: 운영자 설정으로 기능을 껐으면 false. 등록에서 빠져 디스코드 명령 목록에 뜨지 않는다(기동 때, 그 설정을 저장할 때의 배포에서)
 * autocomplete: 자동완성을 켠 옵션의 선택지. 3초 안에 respond로 응답한다. 예외를 던지면 호출부(이벤트)가 빈 목록으로 응답한다
 */
type GuildCommand = {
  data: CommandData;
  help: HelpEntry | null;
  anywhere?: false;
  enabled?: () => boolean;
  execute(interaction: ChatInputCommandInteraction<"cached">, bot: BotContext): unknown;
  autocomplete?(interaction: AutocompleteInteraction<"cached">, bot: BotContext): Promise<unknown>;
};
/** 서버 밖(DM)에서도 쓰는 명령 */
type AnywhereCommand = { data: CommandData; help: HelpEntry | null; anywhere: true; enabled?: () => boolean; execute(interaction: ChatInputCommandInteraction, bot: BotContext): unknown };
/** 슬래시 명령 모듈. 정의(data)와 실행(execute) */
type SlashCommand = GuildCommand | AnywhereCommand;

// 배포 해시 저장 파일. 정의가 바뀌지 않은 기동에서는 등록 PUT을 건너뛴다
const HASH_PATH = path.join(PROJECT.database, "deployed-commands.json");

/** 켜진 명령. 배포하는 것과 실행 목록에 올리는 것이 이 집합이다(꺼진 기능은 진입점이 없다) */
function enabledCommands() {
  return COMMANDS.filter((command) => command.enabled?.() ?? true);
}

/** 켜진 명령이 바뀌면(운영 설정값을 저장해 기능을 켜거나 껐다) 실행 목록을 다시 만들고(load) 등록을 맞춘다(deploy). 떼는 함수를 돌려준다 */
function followEnabledCommands(load: () => void, deploy: () => void) {
  const namesOf = () =>
    enabledCommands()
      .map((command) => command.data.name)
      .join(" ");
  let names = namesOf();
  return onTunablesChanged(() => {
    const now = namesOf();
    if (now === names) return;
    names = now;
    load();
    deploy();
  });
}

/** 배포용 JSON */
function definitions() {
  return enabledCommands().map((command) => command.data.toJSON());
}

// 명령 정의 + 배포 대상(앱, 범위, 서버)의 해시. 어느 하나라도 바뀌면 재배포한다
function deployFingerprint(scope: string, guildId: string | null, commands: unknown[]) {
  const src = JSON.stringify({ clientId: config.discord.clientId, scope, guildId, commands });
  return crypto.createHash("sha256").update(src).digest("hex");
}

// 읽지 못하면 재배포한다(안전한 쪽). 파일이 없는 것은 첫 배포라 남기지 않는다
function readDeployedFingerprint(hashPath: string) {
  try {
    return JSON.parse(fs.readFileSync(hashPath, "utf8")).fingerprint || null;
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.warn(`명령어 배포 해시 읽기 실패: ${messageOf(error)}`);
    return null;
  }
}

// 해시 저장 실패는 다음 기동에서 한 번 더 배포될 뿐이다
function writeDeployedFingerprint(hashPath: string, fingerprint: string) {
  try {
    fs.mkdirSync(path.dirname(hashPath), { recursive: true });
    fs.writeFileSync(hashPath, JSON.stringify({ fingerprint, deployedAt: new Date().toISOString() }));
  } catch (error) {
    log.warn(`명령어 배포 해시 저장 실패: ${messageOf(error)}`);
  }
}

/** 명령 등록 요청. 경로와 정의를 받아 디스코드가 등록한 명령 목록을 돌려준다 */
type PutCommands = (route: `/${string}`, body: RESTPostAPIApplicationCommandsJSONBody[]) => Promise<RESTPutAPIApplicationCommandsResult>;
/** 등록된 명령 목록 읽기(등록을 건너뛴 기동에서 명령 id를 받는다) */
type GetCommands = (route: `/${string}`) => Promise<Array<{ name: string; id: string }>>;
// 디스코드 API의 응답을 등록한 명령 목록으로 본다
const putCommands: PutCommands = async (route, body) => (await new REST().setToken(config.discord.token).put(route, { body })) as RESTPutAPIApplicationCommandsResult;
const getCommands: GetCommands = async (route) => (await new REST().setToken(config.discord.token).get(route)) as Array<{ name: string; id: string }>;

type DeployResult = { ok: true; skipped: boolean; count: number; scope: string; guildId: string | null; names: string[] } | { ok: false; error: unknown; scope: string; guildId: string | null; hint: string | null };

// 슬래시 명령을 디스코드에 등록한다. 기동은 정의가 그대로면(해시가 같으면) 건너뛰고, 대시보드의 다시 등록, 수동 스크립트는 force로 늘 등록한다.
// 등록한 명령의 id는 명령 멘션 표(ui/command-mentions)에 둔다. 건너뛰었으면 등록된 목록을 한 번 읽어 온다(못 읽으면 멘션이 글자로 남을 뿐이다).
// hashPath, put, get은 테스트가 넘기는 슬롯(임시 파일이라 운영 해시를 건드리지 않고, 실제로 등록하거나 읽지 않는다)
async function deployCommands({ force = false, hashPath = HASH_PATH, put = putCommands, get = getCommands }: { force?: boolean; hashPath?: string; put?: PutCommands; get?: GetCommands } = {}): Promise<DeployResult> {
  const scope = config.discord.guildId ? "guild" : "global";
  const guildId = config.discord.guildId || null;
  const commands = definitions();
  const fingerprint = deployFingerprint(scope, guildId, commands);
  const route = guildId ? Routes.applicationGuildCommands(config.discord.clientId, guildId) : Routes.applicationCommands(config.discord.clientId);

  if (!force && readDeployedFingerprint(hashPath) === fingerprint) {
    try {
      rememberCommandIds(await get(route), guildId);
    } catch (error) {
      log.warn(`등록된 슬래시 명령어 읽기 실패(도움말의 명령어가 클릭할 수 없는 일반 텍스트로 보임): ${messageOf(error)}`);
    }
    return { ok: true, skipped: true, count: commands.length, scope, guildId, names: commands.map((c) => c.name) };
  }

  try {
    const data = await put(route, commands);
    writeDeployedFingerprint(hashPath, fingerprint); // 성공 시에만 기록. 실패하면 다음 기동에 재시도
    rememberCommandIds(data, guildId);
    return { ok: true, skipped: false, count: data.length, scope, guildId, names: data.map((c) => c.name) };
  } catch (error) {
    return { ok: false, error, scope, guildId, hint: deployHint(scope, guildId, error) };
  }
}

// 배포 실패의 원인 안내. 디스코드 오류 코드와 범위로 원인이 하나로 좁혀지는 것만 붙인다.
// 서버 경로의 50001은 봇이 없는 서버와 존재하지 않는 서버 ID를 구분해 주지 않는다. 전역 50001, 50035, 401은 원인을 짐작할 근거가 없다
function deployHint(scope: string, guildId: string | null, error: unknown): string | null {
  const code = codeOf(error);
  if (scope === "guild" && code === RESTJSONErrorCodes.MissingAccess) return `GUILD_ID 서버(${guildId ?? "없음"})에 봇이 없음. .env의 GUILD_ID가 맞는지, 봇이 서버에서 나가지 않았는지 확인하세요`;
  if (code === RESTJSONErrorCodes.NotAuthorizedToPerformThisActionOnThisApplication || code === RESTJSONErrorCodes.UnknownApplication) {
    return `CLIENT_ID(${config.discord.clientId})가 봇 토큰의 앱이 아님. 개발자 포털의 Application ID와 .env의 CLIENT_ID가 같은지 확인하세요`;
  }
  return null;
}

/** 배포 실패를 로그, 터미널에 남길 줄. 원인 안내(hint)가 있으면 둘째 줄 */
function deployErrorLines(result: { scope: string; error: unknown; hint: string | null }) {
  return [`명령어 배포 실패(${result.scope}): ${messageOf(result.error)}`, ...(result.hint ? [result.hint] : [])];
}

export { enabledCommands, followEnabledCommands, definitions, deployCommands, deployErrorLines };
export type { SlashCommand, GuildCommand, AnywhereCommand, PutCommands, GetCommands, DeployResult };
