// .env 만들기 · 읽기. 없을 때만 .env.example 을 복사하고 무작위로 만들 수 있는 비밀(SECRETS_KEY · SESSION_SECRET)을 채운다.
// 봇 토큰 등은 사람이 채운다. 이미 있으면 절대 덮지 않는다.
// 부르는 곳: 설치(scripts/setup-config)와 진입 파일의 첫 줄(app/env-bootstrap). pnpm 은 의존성이 그대로면 설치 뒤 단계를 건너뛰므로 기동도 만든다.
// 읽기는 진입 파일만 한다(설정 모듈은 process.env 만 본다). 테스트는 진입 파일을 부르지 않으므로 .env 를 읽지 않는다

import fs from "fs";
import path from "path";
import { PROJECT } from "../infra/project-paths.ts";
import { newSecretsKey, newSessionSecret } from "../rules/secrets-key.ts";

/** 사람이 채워야 하는 값(.env.example 의 [필수] 중 무작위로 못 만드는 것) */
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
  return true;
}

/** .env 가 있으면 process.env 에 올린다. 이미 있는 환경 변수(셸이 준 값)는 덮지 않는다. 읽었으면 true */
function loadEnv(target = PROJECT.env) {
  if (!fs.existsSync(target)) return false;
  process.loadEnvFile(target);
  return true;
}

/** 만든 뒤 알릴 한 줄 */
const madeLine = () => `.env 가 없어 .env.example 로 만들었습니다(SECRETS_KEY · SESSION_SECRET 은 채웠습니다). ${FILL_BY_HAND.join(" · ")} 을 채운 뒤 실행하세요.`;

export { setupEnv, loadEnv, fillLine, madeLine, FILL_BY_HAND };
