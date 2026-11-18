// bgutil-ytdlp-pot-provider(POToken 공급자) 설치. pnpm run install:bgutil, update:bgutil(같은 일을 한다).
//   설정한 태그와 커밋을 vendor/bgutil/<태그>-<받은 시각>/에 받아 빌드하고, 띄워 본 뒤 가리킴(vendor/bgutil/state.json)을 바꾼다(src/sources/bgutil/install).
//   새 폴더에 받으므로 봇이 켜져 있어도 되고(돌고 있는 POToken 서버가 쥔 파일과 부딪치지 않는다), 켜져 있는 봇은 다시 시작하면 새 것을 쓴다.
//   --force: 이미 그 태그와 커밋이어도 새 폴더에 다시 받는다(망가진 설치를 고칠 때).
//
// 받는 버전은 src/config/vendor-versions.ts의 기본 태그와 커밋이고, .env의 BGUTIL_VERSION, BGUTIL_COMMIT으로 바꾼다.
// 기본 브랜치를 따라가지 않고 잠금 파일을 고치지 않는다(npm audit fix 없음). 설치한 날에 따라 다른 코드가 깔리지 않게.
// 잠금 파일의 취약점은 새 태그로 고친다(주마다 도는 vendor-updates 워크플로가 알린다).
// 설치 스크립트는 잠금 파일에서 설치 스크립트가 있는 실행 의존성(canvas)만 돌린다. 개발 의존성의 설치 스크립트는 잠금 파일 밖에서 받을 수 있다.
// 봇 모듈 중 로거를 부르는 것은 불러오지 않는다(로거가 console을 가로챈다).

import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import path from "node:path";
import config from "../src/config/index.ts";
import { BGUTIL_COMMIT, BGUTIL_VERSION } from "../src/config/vendor-versions.ts";
import { bgutilPin } from "../src/rules/bgutil-install.ts";
import { checkoutPinned, gitWith } from "../src/infra/pinned-checkout.ts";
import { runTool } from "../src/infra/tool-run.ts";
import { toolEnv } from "../src/config/tool-env.ts";
import { messageOf } from "../src/rules/error-kind.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { acquireInstanceLock } from "../src/infra/instance-lock.ts";
import { installBgutil, type InstallIo, type InstallOutcome } from "../src/sources/bgutil/install.ts";
import { trialRun } from "../src/sources/bgutil/trial.ts";

const REPO = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git";
const TAGS_URL = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/tags";

// 명령마다의 상한(ms). 체크아웃의 git(합쳐 11분)과 이 셋을 더해도 30분 안이다
const NPM_CI_MS = 10 * 60_000;
const NPM_REBUILD_MS = 5 * 60_000;
const TSC_MS = 3 * 60_000;

// 외부 도구에는 봇의 비밀값 환경 변수를 뺀 환경을 넘긴다(npm rebuild는 다운로드한 의존성의 설치 스크립트를 실행한다)
const env = toolEnv();
const show = (dir: string) => path.relative(PROJECT.root, dir);

// 윈도우의 npm은 .cmd라 셸로 실행한다. 인자는 잠금 파일의 패키지 이름뿐이다(rebuildTargets가 모양을 본다)
async function npm(serverDir: string, args: string[], timeoutMs: number) {
  const cmd = `npm ${args.join(" ")}`;
  console.log(`$ ${cmd}   (${show(serverDir)})`);
  const run = { cwd: serverDir, env, label: cmd, timeoutMs };
  await (process.platform === "win32" ? runTool(cmd, [], { ...run, shell: true }) : runTool("npm", args, run));
}

const io: InstallIo = {
  checkout: (repoDir, tag, commit) => checkoutPinned({ dir: repoDir, repo: REPO, tag, commit, git: gitWith(env), log: (line) => console.log(`$ ${line}   (${show(repoDir)})`) }),
  npmCi: (serverDir) => npm(serverDir, ["ci", "--ignore-scripts"], NPM_CI_MS),
  npmRebuild: (serverDir, names) => npm(serverDir, ["rebuild", ...names], NPM_REBUILD_MS),
  // build/main.js 생성(tsconfig outDir=./build). npx를 거치지 않고 잠금 파일의 typescript를 쓴다
  tsc: async (serverDir) => {
    const tsc = path.join(serverDir, "node_modules", "typescript", "bin", "tsc");
    console.log(`$ node ${path.relative(serverDir, tsc)}   (${show(serverDir)})`);
    await runTool(process.execPath, [tsc], { cwd: serverDir, env, label: "tsc", timeoutMs: TSC_MS });
  },
  trial: trialRun,
  now: () => Date.now(),
  pid: process.pid,
  log: (line) => console.log(`ℹ️  [bgutil] ${line}`),
};

/** 봇이 켜져 있나. parent: 이 스크립트를 띄운 봇(기동의 받기), other: 따로 켜져 있는 봇 */
async function botNow(): Promise<"none" | "parent" | "other"> {
  const held = await acquireInstanceLock(PROJECT.database);
  if (held.ok) {
    await held.release();
    return "none";
  }
  return held.holder === process.ppid ? "parent" : "other";
}

function report(outcome: InstallOutcome, bot: "none" | "parent" | "other"): number {
  for (const note of outcome.notes) console.warn(`⚠️  [bgutil] ${note}`);
  // 켜져 있는 봇은 기동 때 정한 빌드를 계속 쓴다. yt-dlp 플러그인은 서버와 메이저 버전이 다르면 거부하므로 둘을 함께 바꿔야 한다
  const restart = bot === "none" ? "" : ". 켜져 있는 봇은 다시 시작해야 적용됩니다";
  switch (outcome.kind) {
    case "unchanged":
      console.log(`ℹ️  [bgutil] 이미 ${outcome.tag}(서버 ${outcome.version}) 버전을 쓰고 있습니다`);
      return 0;
    case "installed":
      console.log(`✅ [bgutil] ${outcome.tag}(서버 ${outcome.version}) 버전을 설치했습니다${outcome.from ? `(이전 ${outcome.from})` : ""}${restart}`);
      return 0;
    case "failed":
      console.error(`❌ [bgutil] ${outcome.tag} 설치 실패: ${outcome.reason}. 지금 쓰는 bgutil은 그대로입니다`);
      console.error("   git과 node, 그리고 canvas 네이티브 모듈용 빌드 툴체인이 설치돼 있는지, 네트워크와 태그를 확인하세요");
      return 1;
    case "busy":
      console.error(`❌ [bgutil] 다른 프로세스(${outcome.holder ? `PID ${outcome.holder}` : "PID 모름"})가 vendor/bgutil을 쓰는 중이라 건너뜁니다`);
      return 1;
  }
}

async function main(): Promise<number> {
  const pin = bgutilPin(config.bgutil.version, config.bgutil.commit, { version: BGUTIL_VERSION, commit: BGUTIL_COMMIT });
  if ("error" in pin) {
    console.error(`❌ [bgutil] ${pin.error}`);
    console.error(`   태그 목록: ${TAGS_URL}`);
    return 1;
  }
  const bot = await botNow();
  const outcome = await installBgutil({ dir: PROJECT.bgutil, tag: pin.tag, commit: pin.commit, force: process.argv.includes("--force"), io });
  return report(outcome, bot);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`❌ [bgutil] 설치 실패: ${messageOf(error)}. 지금 쓰는 bgutil은 그대로입니다`);
  process.exitCode = 1;
}
