// bgutil-ytdlp-pot-provider (POToken 공급자) 설치/업데이트 스크립트.
//   pnpm run install:bgutil · update:bgutil. 둘은 같은 일을 한다:
//   없으면 git clone, 설정한 태그로 체크아웃, 의존성 설치 + 빌드
//
// 받는 판은 config.ts 의 기본 태그이고, .env 의 BGUTIL_VERSION 으로 바꾼다.
// 기본 브랜치를 따라가지 않는다. 설치한 날에 따라 다른 코드가 깔린다.
//
// bgutil은 별도로 가져와야 한다.
// 봇 실행 시 자동 감지되어 POToken 서버(포트 4416)를 함께 시작한다.

import { execSync, execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import config from "../config.ts";
import { messageOf } from "../src/rules/errorKind.ts";

const ROOT = path.join(import.meta.dirname, "..");
const DIR = path.join(ROOT, "bgutil-ytdlp-pot-provider");
const SERVER = path.join(DIR, "server");
const REPO = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git";
const TAGS_URL = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/tags";
const VERSION = config.bgutil.version;

function run(cmd: string, cwd: string) {
  console.log(`\n$ ${cmd}   (${path.relative(ROOT, cwd) || "."})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

// 태그는 .env 에서 온다. 셸을 거치지 않고 인자로 넘긴다
function git(args: string[], cwd: string) {
  console.log(`\n$ git ${args.join(" ")}   (${path.relative(ROOT, cwd) || "."})`);
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

// 지금 체크아웃이 가리키는 태그. 태그 위가 아니면 null
function currentTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--exact-match", "HEAD"], { cwd: DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function hasTag(tag: string) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { cwd: DIR, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

try {
  const existed = fs.existsSync(DIR);
  if (!existed) git(["clone", REPO, "bgutil-ytdlp-pot-provider"], ROOT);

  const before = currentTag();
  const moved = before !== VERSION;
  if (!moved) {
    console.log(`ℹ️  bgutil ${VERSION}이 이미 체크아웃돼 있습니다. 의존성 설치 + 빌드만 진행합니다.`);
  } else {
    // npm audit fix가 server/package-lock.json을 로컬 변경하므로, 원복해야 다른 태그로 옮길 수 있다
    git(["checkout", "--", "."], DIR);
    if (!hasTag(VERSION)) git(["fetch", "--tags", "origin"], DIR);
    if (!hasTag(VERSION)) {
      console.error(`\n❌ bgutil에 ${VERSION} 태그가 없습니다. .env의 BGUTIL_VERSION을 확인하세요 (태그 목록: ${TAGS_URL})`);
      process.exit(1);
    }
    git(["-c", "advice.detachedHead=false", "checkout", "--detach", `refs/tags/${VERSION}`], DIR);
    console.log(`ℹ️  bgutil ${before ?? "(태그 밖)"} → ${VERSION}`);
  }

  if (!fs.existsSync(SERVER)) throw new Error(`server 디렉터리를 찾을 수 없습니다: ${SERVER}`);

  // bgutil은 자체 npm 프로젝트(별도 ecosystem). package-lock 기반 재현 설치, 실패 시 install로 폴백
  try {
    run("npm ci", SERVER);
  } catch {
    console.warn("⚠️  npm ci 실패 → npm install로 폴백합니다.");
    run("npm install", SERVER);
  }

  // upstream 잠금 파일의 알려진 취약 전이 의존성을 semver 범위 내에서 교체 (예: form-data GHSA-hmw2-7cc7-3qxx).
  // 로컬 변경분은 태그를 옮길 때 원복 후 재적용. upstream이 잠금을 고치면 자연히 no-op.
  try {
    run("npm audit fix", SERVER);
  } catch {
    console.warn("⚠️  npm audit fix 실패(네트워크/레지스트리 문제일 수 있음). 설치는 계속 진행합니다. 나중에 bgutil-ytdlp-pot-provider/server에서 직접 실행해 주세요.");
  }

  run("npx tsc", SERVER); // build/main.js 생성 (tsconfig outDir=./build)

  console.log("\n✅ bgutil POToken 공급자 준비 완료. 봇 실행 시 자동 감지되어 포트 4416에서 함께 시작됩니다.");
  if (existed && moved) {
    // yt-dlp 플러그인은 서버와 메이저 버전이 다르면 거부한다(경고가 아니라 중단).
    // 봇이 띄워 둔 서버는 예전 코드를 그대로 물고 있으므로, 재시작 전까지 POToken이 아예 나오지 않는다.
    console.log("\n⚠️  봇이 실행 중이라면 재시작하세요.");
    console.log("   봇이 띄운 POToken 서버는 아직 이전 버전으로 돌고 있고,");
    console.log("   플러그인과 메이저 버전이 다르면 토큰 발급이 거부됩니다.");
  }
} catch (e) {
  console.error("\n❌ bgutil 설치/업데이트 실패:", messageOf(e));
  console.error("   git / node / (canvas 네이티브 모듈용 빌드 툴체인)이 설치돼 있는지 확인하세요.");
  process.exit(1);
}
