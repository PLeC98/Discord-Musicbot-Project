"use strict";

// bgutil-ytdlp-pot-provider (POToken 공급자) 설치/업데이트 스크립트.
//   pnpm run install:bgutil   — 없으면 git clone, 그 후 의존성 설치 + 빌드
//   pnpm run update:bgutil    — git pull 후 재설치 + 재빌드 (--update)
//
// bgutil은 별도로 가져와야 한다.
// 봇 실행 시 자동 감지되어 POToken 서버(포트 4416)를 함께 시작한다.

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "bgutil-ytdlp-pot-provider");
const SERVER = path.join(DIR, "server");
const REPO = "https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git";
const isUpdate = process.argv.includes("--update");

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}   (${path.relative(ROOT, cwd) || "."})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

try {
  const exists = fs.existsSync(DIR);

  if (!exists) {
    if (isUpdate) console.log("ℹ️  bgutil 디렉터리가 없어 새로 clone합니다.");
    run(`git clone ${REPO} bgutil-ytdlp-pot-provider`, ROOT);
  } else if (isUpdate) {
    run("git pull --ff-only", DIR);
  } else {
    console.log("ℹ️  bgutil 디렉터리가 이미 있습니다. 의존성 설치 + 빌드만 진행합니다. (업데이트는 pnpm run update:bgutil)");
  }

  if (!fs.existsSync(SERVER)) throw new Error(`server 디렉터리를 찾을 수 없습니다: ${SERVER}`);

  // bgutil은 자체 npm 프로젝트(별도 ecosystem) — package-lock 기반 재현 설치, 실패 시 install로 폴백
  try {
    run("npm ci", SERVER);
  } catch {
    console.warn("⚠️  npm ci 실패 → npm install로 폴백합니다.");
    run("npm install", SERVER);
  }
  run("npx tsc", SERVER); // build/main.js 생성 (tsconfig outDir=./build)

  console.log("\n✅ bgutil POToken 공급자 준비 완료. 봇 실행 시 자동 감지되어 포트 4416에서 함께 시작됩니다.");
} catch (e) {
  console.error("\n❌ bgutil 설치/업데이트 실패:", e.message);
  console.error("   git / node / (canvas 네이티브 모듈용 빌드 툴체인)이 설치돼 있는지 확인하세요.");
  process.exit(1);
}
