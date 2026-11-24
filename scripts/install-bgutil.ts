// bgutil-ytdlp-pot-provider(POToken 공급자) 설치. pnpm run install:bgutil, update:bgutil(같은 일을 한다).
//   태그와 커밋을 vendor/bgutil/<태그>-<설치 시각>/에 다운로드해 빌드하고, 실행 테스트를 거친 뒤 가리킴(vendor/bgutil/state.json)을 바꾼다(src/sources/bgutil/install).
//   새 폴더에 설치하므로 봇이 켜져 있어도 되고(돌고 있는 POToken 서버가 쥔 파일과 부딪치지 않는다), 켜져 있는 봇은 다시 시작하면 새 것을 쓴다.
//
// 설치하는 버전은 업데이트 탭의 bgutil 카드가 고정한 태그와 커밋(설정 DB)이고, 고정하지 않았거나 설정 DB가 없으면(첫 설치) src/config/vendor-versions.ts의 기본 짝이다.
//   설정 DB가 있는데 읽지 못하면 설치하지 않고 1로 끝난다(저장해 둔 고정을 무시하고 기본값을 설치하지 않게).
// --pin <태그> [--commit <커밋>]: 그 태그를 설치하고 고정한다. 커밋을 주지 않으면 저장소에서 태그가 가리키는 커밋을 확인해 보인다. --unpin: 고정을 풀고 기본값을 설치한다.
//   설치한 뒤에 저장한다(설치하지 못하면 설정은 그대로). 봇이 켜져 있으면 하지 않는다(대시보드에서 바꾼다): 켜진 봇은 설정을 메모리에 들고 있어 여기서 고쳐도 모른다.
//   그동안 봇 실행 잠금을 쥐어 봇이 켜지지 않게 한다.
// --tag <태그> --commit <커밋>: 그 짝을 설치만 한다(봇의 설치 작업이 넘긴다). --force: 이미 그 태그와 커밋이어도 새 폴더에 다시 설치한다(망가진 설치를 고칠 때).
// 인자는 src/sources/bgutil/cli-args가 읽는다.
//
// 기본 브랜치를 따라가지 않고 잠금 파일을 고치지 않는다(npm audit fix 없음). 설치한 날에 따라 다른 코드가 깔리지 않게.
// 잠금 파일의 취약점은 새 태그로 고친다(주마다 도는 vendor-updates 워크플로가 알린다).
// 설치 스크립트는 잠금 파일에서 설치 스크립트가 있는 실행 의존성(canvas)만 돌린다. 개발 의존성의 설치 스크립트는 잠금 파일 밖에서 받을 수 있다.
// 출력은 봇 로그와 같은 모양으로 찍는다(infra/script-line). 설정 DB를 읽는 모듈은 로거를 부르고 로거는 console을 가로채므로, 그때부터는 로거로 찍는다.

import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import path from "node:path";
import config from "../src/config/index.ts";
import { BGUTIL_COMMIT, BGUTIL_VERSION } from "../src/config/vendor-versions.ts";
import { BGUTIL_REPO, taggedCommit } from "../src/rules/bgutil-install.ts";
import { checkoutPinned, gitWith } from "../src/infra/pinned-checkout.ts";
import { runTool } from "../src/infra/tool-run.ts";
import { toolEnv } from "../src/config/tool-env.ts";
import { messageOf } from "../src/rules/error-kind.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { acquireInstanceLock } from "../src/infra/instance-lock.ts";
import { installBgutil, type InstallIo, type InstallOutcome } from "../src/sources/bgutil/install.ts";
import { trialRun } from "../src/sources/bgutil/trial.ts";
import { scriptLine, type ScriptLevel } from "../src/infra/script-line.ts";
import { logTextError, type LogText } from "../src/infra/log/log-text.ts";
import { parseInstallArgs, type InstallMode } from "../src/sources/bgutil/cli-args.ts";
import { L } from "../src/infra/log/text.ts";

const REPO = `https://github.com/${BGUTIL_REPO}.git`;
const TAGS_URL = `https://github.com/${BGUTIL_REPO}/tags`;

// 명령마다의 상한(ms). 체크아웃의 git(합쳐 11분)과 이 셋을 더해도 30분 안이다
const NPM_CI_MS = 10 * 60_000;
const NPM_REBUILD_MS = 5 * 60_000;
const TSC_MS = 3 * 60_000;

// 외부 도구에는 봇의 비밀값 환경 변수를 뺀 환경을 넘긴다(npm rebuild는 다운로드한 의존성의 설치 스크립트를 실행한다)
const env = toolEnv();
const show = (dir: string) => path.relative(PROJECT.root, dir);

const SETTINGS_DB = path.join(PROJECT.database, "settings.db");

let say: (level: ScriptLevel, line: string | LogText) => void = scriptLine("bgutil");

// 설정 DB를 읽는 모듈을 부른 뒤로는 로거로 찍는다(같은 모양)
async function sayWithLogger() {
  const { default: logger } = await import("../src/infra/log/logger.ts");
  const log = logger.child({ category: "bgutil" });
  say = (level, line) => log[level](line);
}

// 윈도우의 npm은 .cmd라 셸로 실행한다. 인자는 잠금 파일의 패키지 이름뿐이다(rebuildTargets가 모양을 본다)
async function npm(serverDir: string, args: string[], timeoutMs: number) {
  const cmd = `npm ${args.join(" ")}`;
  const run = { cwd: serverDir, env, label: cmd, timeoutMs };
  await (process.platform === "win32" ? runTool(cmd, [], { ...run, shell: true }) : runTool("npm", args, run));
}

const io: InstallIo = {
  checkout: (repoDir, tag, commit) => checkoutPinned({ dir: repoDir, repo: REPO, tag, commit, git: gitWith(env), log: (line) => say("info", `${line} (${show(repoDir)})`) }),
  npmCi: (serverDir) => npm(serverDir, ["ci", "--ignore-scripts"], NPM_CI_MS),
  npmRebuild: (serverDir, names) => npm(serverDir, ["rebuild", ...names], NPM_REBUILD_MS),
  // build/main.js 생성(tsconfig outDir=./build). npx를 거치지 않고 잠금 파일의 typescript를 쓴다
  tsc: async (serverDir) => {
    const tsc = path.join(serverDir, "node_modules", "typescript", "bin", "tsc");
    await runTool(process.execPath, [tsc], { cwd: serverDir, env, label: "tsc", timeoutMs: TSC_MS });
  },
  trial: trialRun,
  now: () => Date.now(),
  pid: process.pid,
  log: (line) => say("info", line),
};

/** 봇이 켜져 있나. parent: 이 스크립트를 띄운 봇(봇의 설치 작업), other: 따로 켜져 있는 봇 */
async function botNow(): Promise<"none" | "parent" | "other"> {
  const held = await acquireInstanceLock(PROJECT.database);
  if (held.ok) {
    await held.release();
    return "none";
  }
  return held.holder === process.ppid ? "parent" : "other";
}

function report(outcome: InstallOutcome, bot: "none" | "parent" | "other"): number {
  for (const note of outcome.notes) say("warn", note);
  switch (outcome.kind) {
    case "unchanged":
      say("info", L.bgutil.alreadyInUse({ tag: outcome.tag, version: outcome.version }));
      return 0;
    case "installed":
      say("info", L.bgutil.installed({ tag: outcome.tag, version: outcome.version, from: outcome.from }));
      // 켜져 있는 봇은 기동 때 정한 빌드를 계속 쓴다. yt-dlp 플러그인은 서버와 메이저 버전이 다르면 거부하므로 둘을 함께 바꿔야 한다
      if (bot !== "none") say("warn", L.bgutil.restartBot());
      return 0;
    case "failed":
      say("error", L.bgutil.installFailed({ tag: outcome.tag, reason: outcome.reason }));
      say("error", L.bgutil.installFailedHint());
      return 1;
    case "busy":
      say("error", L.bgutil.busy({ holder: outcome.holder }));
      return 1;
  }
}

type Target = { tag: string; commit: string };

// 설정 DB의 고정을 설정 객체에 올린다(없으면 기본값). 읽지 못하면 예외를 던진다
async function settingsTarget(): Promise<Target> {
  const tunables = await import("../src/store/tunables.ts");
  await sayWithLogger();
  tunables.loadReadOnly(SETTINGS_DB, { strict: true });
  return { tag: config.bgutil.version, commit: config.bgutil.commit };
}

// 태그가 가리키는 커밋을 저장소에서 확인한다
async function remoteCommit(tag: string): Promise<string> {
  const out = await gitWith(env)(["ls-remote", REPO, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], PROJECT.root);
  const commit = taggedCommit(out, tag);
  if (!commit) throw logTextError(L.bgutil.tagNotFound({ tag, tagsUrl: TAGS_URL }));
  say("info", L.bgutil.tagCommit({ tag, commit }));
  return commit;
}

/** 설치한다. 설치했거나 이미 그것이면 true. botOff: 봇 실행 잠금을 이 스크립트가 쥐고 있다(--pin, --unpin) */
async function install(target: Target, force: boolean, botOff = false): Promise<boolean> {
  const bot = botOff ? "none" : await botNow();
  const outcome = await installBgutil({ dir: PROJECT.bgutil, tag: target.tag, commit: target.commit, force, io });
  return report(outcome, bot) === 0;
}

// --pin, --unpin: 봇이 꺼져 있을 때만. 설정 DB를 쓰기로 열고, 설치한 뒤 저장한다
async function changePin(mode: Extract<InstallMode, { kind: "pin" | "unpin" }>, force: boolean): Promise<boolean> {
  const held = await acquireInstanceLock(PROJECT.database);
  if (!held.ok) throw logTextError(L.bgutil.pinBotRunning({ holder: held.holder }));
  const { settingsDb } = await import("../src/store/settings-db.ts");
  const tunables = await import("../src/store/tunables.ts");
  await sayWithLogger();
  try {
    settingsDb.open(SETTINGS_DB);
    tunables.load();
    const was = config.bgutil.pinned ? `${config.bgutil.version}(${config.bgutil.commit})` : L.bgutil.pinNone();
    const target = mode.kind === "unpin" ? { tag: BGUTIL_VERSION, commit: BGUTIL_COMMIT } : { tag: mode.tag, commit: mode.commit ?? (await remoteCommit(mode.tag)) };
    if (!(await installGuarded(target, force))) {
      say("warn", L.bgutil.pinKeptAfterFailure({ was }));
      return false;
    }
    tunables.saveCard(mode.kind === "unpin" ? { BGUTIL_VERSION: null, BGUTIL_COMMIT: null } : { BGUTIL_VERSION: target.tag, BGUTIL_COMMIT: target.commit });
    say("warn", L.bgutil.pinChanged({ was, now: mode.kind === "unpin" ? L.bgutil.pinNone() : `${target.tag}(${target.commit})` }));
    return true;
  } finally {
    settingsDb.close();
    await held.release();
  }
}

// 설치하는 동안의 예외는 실패 줄로 남기고 false(--pin, --unpin. 봇 실행 잠금을 쥔 채 부른다)
async function installGuarded(target: Target, force: boolean): Promise<boolean> {
  try {
    return await install(target, force, true);
  } catch (error) {
    say("error", L.bgutil.installFailed({ tag: target.tag, reason: messageOf(error) }));
    return false;
  }
}

async function main(): Promise<number> {
  const args = parseInstallArgs(process.argv);
  if ("error" in args) {
    say("error", args.error);
    return 1;
  }
  const { mode, force } = args;
  if (mode.kind === "pin" || mode.kind === "unpin") return (await changePin(mode, force)) ? 0 : 1;
  if (mode.kind === "exact") return (await install(mode, force)) ? 0 : 1;
  let target: Target;
  try {
    target = await settingsTarget();
  } catch (error) {
    say("error", L.bgutil.settingsUnread({ error: messageOf(error) }));
    return 1;
  }
  return (await install(target, force)) ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  say("error", L.bgutil.failed({ error: messageOf(error) }));
  process.exitCode = 1;
}
