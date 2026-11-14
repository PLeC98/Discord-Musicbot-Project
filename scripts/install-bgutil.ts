// bgutil-ytdlp-pot-provider (POToken 공급자) 설치/업데이트 스크립트.
//   pnpm run install:bgutil, update:bgutil. 둘은 같은 일을 한다:
//   설정한 태그를 받아 고정한 커밋인지 맞춰 보고, 그 커밋으로 깨끗하게 체크아웃, 그 태그의 잠금 파일 그대로 의존성 설치 + 빌드
//
// 설치하는 버전은 src/config/vendor-versions.ts 의 기본 태그와 커밋이고, .env 의 BGUTIL_VERSION, BGUTIL_COMMIT 으로 바꾼다.
// 기본 브랜치를 따라가지 않고 잠금 파일을 고치지 않는다(npm audit fix 없음). 설치한 날에 따라 다른 코드가 깔리지 않게.
// 잠금 파일의 취약점은 새 태그로 고친다(주마다 도는 vendor-updates 워크플로가 알린다).
// 설치 스크립트는 잠금 파일에서 설치 스크립트가 있는 실행 의존성(canvas)만 돌린다. 개발 의존성의 설치 스크립트는 잠금 파일 밖에서 받을 수 있다.
//
// 봇은 실행 시 설치된 bgutil을 감지해 POToken 서버를 함께 시작한다(실행마다 빈 포트).

import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import config from "../src/config/index.ts";
import { BGUTIL_COMMIT, BGUTIL_VERSION } from "../src/config/vendor-versions.ts";
import { bgutilPin, rebuildTargets, rootInstallScripts } from "../src/rules/bgutil-install.ts";
import { checkoutPinned } from "../src/infra/pinned-checkout.ts";
import { messageOf } from "../src/rules/error-kind.ts";
import { PROJECT } from "../src/infra/project-paths.ts";

const ROOT = PROJECT.root;
const DIR = PROJECT.bgutil;
const SERVER = path.join(DIR, "server");
const REPO = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git";
const TAGS_URL = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/tags";

// 윈도우의 npm 은 .cmd 라 셸로 부른다. 인자는 잠금 파일의 패키지 이름뿐이다
function npm(args: string[]) {
  const cmd = `npm ${args.join(" ")}`;
  console.log(`\n$ ${cmd}   (${path.relative(ROOT, SERVER)})`);
  execFileSync(cmd, { cwd: SERVER, stdio: "inherit", shell: true });
}

function fail(lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const pin = bgutilPin(config.bgutil.version, config.bgutil.commit, { version: BGUTIL_VERSION, commit: BGUTIL_COMMIT });
if ("error" in pin) fail([`\n❌ ${pin.error}`, `   태그 목록: ${TAGS_URL}`]);
const { tag, commit } = pin;

try {
  try {
    checkoutPinned({ dir: DIR, repo: REPO, tag, commit, log: (line) => console.log(`\n$ ${line}   (${path.relative(ROOT, DIR)})`) });
  } catch (error) {
    fail([`\n❌ bgutil ${tag} 받기 실패: ${messageOf(error)}`, "   윈도우에서는 봇이 켜져 있으면 POToken 서버가 node_modules 의 파일(canvas.node)을 물고 있어 지우지 못합니다. 봇을 끄고 다시 실행하세요.", `   그 밖이면 네트워크와 태그(${TAGS_URL})를 확인하세요.`]);
  }
  console.log(`ℹ️  bgutil ${tag} (${commit.slice(0, 12)}) 체크아웃 확인`);

  if (!fs.existsSync(SERVER)) throw new Error(`server 디렉터리를 찾을 수 없습니다: ${SERVER}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(SERVER, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
  const rootScripts = rootInstallScripts(pkg);
  if (rootScripts.length) fail([`\n❌ bgutil ${tag} 의 server/package.json 에 설치 스크립트(${rootScripts.join(", ")})가 생겼습니다. 무엇을 하는지 확인한 뒤 이 설치 스크립트를 고치세요.`]);
  const rebuild = rebuildTargets(JSON.parse(fs.readFileSync(path.join(SERVER, "package-lock.json"), "utf8")));

  // bgutil은 자체 npm 프로젝트(별도 ecosystem). 잠금 파일 그대로만 설치한다(npm install 로 넘어가면 그날의 트리가 깔린다)
  try {
    npm(["ci", "--ignore-scripts"]);
    if (rebuild.length) npm(["rebuild", ...rebuild]);
  } catch {
    fail(["\n❌ 의존성 설치 실패. 위의 npm 오류를 보세요(네트워크, canvas 네이티브 모듈용 빌드 툴체인)."]);
  }

  // build/main.js 생성(tsconfig outDir=./build). npx 를 거치지 않고 잠금 파일의 typescript 를 쓴다
  const tsc = path.join(SERVER, "node_modules", "typescript", "bin", "tsc");
  console.log(`\n$ node ${path.relative(SERVER, tsc)}   (${path.relative(ROOT, SERVER)})`);
  execFileSync(process.execPath, [tsc], { cwd: SERVER, stdio: "inherit" });

  console.log("\n✅ bgutil POToken 공급자 준비 완료. 봇 실행 시 자동 감지되어 함께 시작됩니다.");
  // yt-dlp 플러그인은 서버와 메이저 버전이 다르면 거부한다(경고가 아니라 중단).
  // 봇이 실행해 둔 서버는 설치 전 코드를 그대로 물고 있으므로, 재시작 전까지 POToken이 아예 나오지 않는다.
  console.log("\n⚠️  봇이 실행 중이라면 재시작하세요.");
  console.log("   봇이 실행한 POToken 서버는 아직 이전 버전으로 돌고 있고,");
  console.log("   플러그인과 메이저 버전이 다르면 토큰 발급이 거부됩니다.");
} catch (e) {
  fail([`\n❌ bgutil 설치/업데이트 실패: ${messageOf(e)}`, "   git / node / (canvas 네이티브 모듈용 빌드 툴체인)이 설치돼 있는지 확인하세요."]);
}
