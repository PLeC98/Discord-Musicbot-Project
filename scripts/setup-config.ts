/**
 * 설정 파일 준비(없을 때만).
 *   .env: .env.example 을 복사하고 무작위로 만들 수 있는 비밀(SECRETS_KEY · SESSION_SECRET)을 채운다. 봇 토큰 등은 사람이 채운다
 *   config/*.yaml: config/*.example.yaml 을 복사한다. 장르 · 상태 설정은 그대로 돌아가는 완성된 데이터다.
 *   예시 파일만 저장소에 추적되므로, 운영자가 자기 취향대로 고쳐도 그 내용이 PR에 실려 전역 기본값이 되는 일이 없다.
 *
 * 이미 있으면 절대 덮지 않는다. 안 그러면 pnpm install 한 번에 운영자가 만든 설정이 날아간다.
 */
import fs from "fs";
import path from "path";
import { messageOf } from "../src/rules/error-kind.ts";
import { PROJECT } from "../src/infra/project-paths.ts";
import { newSecretsKey, newSessionSecret } from "../src/rules/secrets-key.ts";

const CONFIG_DIR = PROJECT.config;
// 이름 뒤에 확장자가 다른 것도 있다(프롬프트는 ChatML 글 파일이다)
const NAMES = ["genres", "status", "ai", "ai-keys", "ai-prompt.chatml"];

// 사람이 채워야 하는 값(.env.example 의 [필수] 중 무작위로 못 만드는 것)
const FILL_BY_HAND = ["DISCORD_TOKEN", "CLIENT_ID", "CLIENT_SECRET"];

/** 예시의 "KEY=   # 주석" 줄에 값을 넣는다. 주석은 남긴다 */
function fillLine(text: string, key: string, value: string) {
  return text.replace(new RegExp(`^${key}=[ \t]*(#.*)?$`, "m"), (_line, comment?: string) => `${key}=${value}${comment ? `  ${comment}` : ""}`);
}

/** .env 가 없으면 예시를 복사해 만들고 무작위 비밀을 채운다. 만들었으면 true */
function setupEnv(target = PROJECT.env, example = path.join(PROJECT.root, ".env.example")) {
  if (fs.existsSync(target)) return false;
  let text = fs.readFileSync(example, "utf8");
  text = fillLine(text, "SECRETS_KEY", newSecretsKey());
  text = fillLine(text, "SESSION_SECRET", newSessionSecret());
  // wx: 그사이 누가 만들었으면 덮지 않고 던진다. 0600: 본인만 읽게(POSIX. Windows 는 사용자 폴더 권한을 따른다)
  fs.writeFileSync(target, text, { flag: "wx", mode: 0o600 });
  console.log(`✅ [config] .env 를 만들었습니다(SECRETS_KEY · SESSION_SECRET 은 채웠습니다). ${FILL_BY_HAND.join(" · ")} 을 채운 뒤 실행하세요.`);
  return true;
}

function setup() {
  setupEnv();
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

export { setup, setupEnv, fillLine, NAMES, CONFIG_DIR };
