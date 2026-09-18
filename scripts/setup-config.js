/**
 * 설정 파일 준비 — config/*.example.yaml → config/*.yaml (없을 때만).
 *
 * `.env`는 값을 채워야 쓸 수 있어서 복사를 사람에게 맡기지만, 장르·상태 설정은 그대로 돌아가는
 * 완성된 데이터라 설치 때 만들어 두는 편이 맞다. 예시 파일만 저장소에 추적되므로,
 * 운영자가 자기 취향대로 고쳐도 그 내용이 PR에 실려 전역 기본값이 되는 일이 없다.
 *
 * **이미 있으면 절대 덮지 않는다** — 안 그러면 pnpm install 한 번에 운영자가 만든 설정이 날아간다.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, "..", "config");
const NAMES = ["genres", "status", "ai"];

function setup() {
  const made = [];
  const missing = [];

  for (const name of NAMES) {
    const target = path.join(CONFIG_DIR, `${name}.yaml`);
    const example = path.join(CONFIG_DIR, `${name}.example.yaml`);

    if (fs.existsSync(target)) continue;
    if (!fs.existsSync(example)) {
      missing.push(path.basename(example));
      continue;
    }
    fs.copyFileSync(example, target);
    made.push(path.basename(target));
  }

  if (made.length) console.log(`✅ [config] 설정 파일을 만들었습니다: ${made.join(", ")}`);
  if (missing.length) console.warn(`⚠️  [config] 예시 파일이 없습니다: ${missing.join(", ")} — 저장소가 온전한지 확인하세요.`);
  return { made, missing };
}

if (require.main === module) {
  try {
    setup();
  } catch (error) {
    // 설치 전체를 깨지 않는다. 파일이 없으면 기동 시 로더가 무엇을 해야 하는지 알려주며 멈춘다.
    console.warn(`⚠️  [config] 설정 파일 준비 실패: ${error.message}`);
  }
}

module.exports = { setup, NAMES, CONFIG_DIR };
