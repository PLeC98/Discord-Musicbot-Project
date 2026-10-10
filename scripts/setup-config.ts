/**
 * 설정 파일 준비(없을 때만).
 *   .env: .env.example 을 복사하고 무작위로 만들 수 있는 비밀(SECRETS_KEY · SESSION_SECRET)을 채운다(config/env-file. 기동도 만든다)
 *   config/*.yaml: config/*.example.yaml 을 복사한다. 장르 · 상태 설정은 그대로 돌아가는 완성된 데이터다.
 *   예시 파일만 저장소에 추적되므로, 운영자가 자기 취향대로 고쳐도 그 내용이 PR에 실려 전역 기본값이 되는 일이 없다.
 *
 * 이미 있으면 절대 덮지 않는다. 안 그러면 pnpm install 한 번에 운영자가 만든 설정이 날아간다.
 */
import fs from "fs";
import path from "path";
import { messageOf } from "../src/rules/error-kind.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { setupEnv, madeLine } from "../src/config/env-file.ts";

const CONFIG_DIR = PROJECT.config;
// 이름 뒤에 확장자가 다른 것도 있다(프롬프트는 ChatML 글 파일이다)
const NAMES = ["genres", "status", "ai", "ai-keys", "ai-prompt.chatml"];

function setup() {
  // .env 는 config/env-file 이 만든다(기동도 같은 것을 부른다)
  if (setupEnv()) console.log(`✅ [config] ${madeLine()}`);
  const made = [];
  const missing = [];

  for (const one of NAMES) {
    const at = one.indexOf(".");
    const [name, ext] = at < 0 ? [one, "yaml"] : [one.slice(0, at), one.slice(at + 1)];
    const target = path.join(CONFIG_DIR, `${name}.${ext}`);
    const example = path.join(CONFIG_DIR, `${name}.example.${ext}`);

    if (fs.existsSync(target)) continue;
    if (!fs.existsSync(example)) {
      missing.push(path.basename(example));
      continue;
    }
    fs.copyFileSync(example, target);
    made.push(path.basename(target));
  }

  if (made.length) console.log(`✅ [config] 설정 파일을 만들었습니다: ${made.join(", ")}`);
  if (missing.length) console.warn(`⚠️  [config] 예시 파일이 없습니다: ${missing.join(", ")}. 저장소가 온전한지 확인하세요.`);
  return { made, missing };
}

if (import.meta.main) {
  try {
    setup();
  } catch (error) {
    // 설치 전체를 깨지 않는다. 파일이 없으면 기동 시 로더가 무엇을 해야 하는지 알려주며 멈춘다.
    console.warn(`⚠️  [config] 설정 파일 준비 실패: ${messageOf(error)}`);
  }
}

export { setup, NAMES, CONFIG_DIR };
