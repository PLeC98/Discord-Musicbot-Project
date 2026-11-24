// .env 만들기, 읽기. 없을 때만 .env.example을 복사하고 무작위로 만든 비밀 키(SECRETS_KEY)를 채운다.
// 봇 토큰 등은 사람이 채운다. 이미 있으면 절대 덮지 않는다.
// 부르는 곳: 설치(scripts/setup-config)와 진입 파일의 첫 줄(app/env-bootstrap). pnpm은 의존성이 그대로면 설치 뒤 단계를 건너뛰므로 기동도 만든다.
// 읽기는 진입 파일만 한다(설정 모듈은 process.env만 본다). 테스트는 진입 파일을 부르지 않으므로 .env를 읽지 않는다

import fs from "fs";
import path from "path";
import { PROJECT } from "../infra/project-paths.ts";
import { newSecretsKey } from "../rules/secrets-key.ts";
import { L } from "../infra/log/text.ts";

/** 사람이 채워야 하는 값(.env.example의 [필수] 중 무작위로 못 만드는 것) */
const FILL_BY_HAND = ["DISCORD_TOKEN", "CLIENT_SECRET"];

/** 예시의 "KEY=   # 주석" 줄에 값을 넣는다. 주석은 남긴다 */
function fillLine(text: string, key: string, value: string) {
  return text.replace(new RegExp(`^${key}=[ \t]*(#.*)?$`, "m"), (_line, comment?: string) => `${key}=${value}${comment ? `  ${comment}` : ""}`);
}

/** .env가 없으면 예시를 복사해 만들고 무작위 비밀을 채운다. 만들었으면 true */
function setupEnv(target = PROJECT.env, example = path.join(PROJECT.root, ".env.example")) {
  if (fs.existsSync(target)) return false;
  let text = fs.readFileSync(example, "utf8");
  text = fillLine(text, "SECRETS_KEY", newSecretsKey());
  // wx: 그사이 누가 만들었으면 덮지 않고 예외를 던진다. 0600: 본인만 읽게(POSIX. Windows는 사용자 폴더 권한을 따른다)
  fs.writeFileSync(target, text, { flag: "wx", mode: 0o600 });
  return true;
}

/** 실행기(scripts/dev)나 셸만 넘기는 이름. .env에 적혀 있어도 올리지 않는다(.env로 켜 둔 채 잊으면 같은 PC의 다른 웹 페이지가 로그인한 대시보드 세션으로 요청할 수 있다) */
const LAUNCHER_ONLY = ["DASHBOARD_DEV_ORIGIN"];

/** .env가 있으면 process.env에 올린다. 이미 있는 환경 변수(셸이 준 값)는 덮지 않고, LAUNCHER_ONLY는 올리지 않는다. 읽었으면 true */
function loadEnv(target = PROJECT.env) {
  if (!fs.existsSync(target)) return false;
  const given = new Set(LAUNCHER_ONLY.filter((name) => name in process.env));
  process.loadEnvFile(target);
  for (const name of LAUNCHER_ONLY) if (!given.has(name)) delete process.env[name];
  return true;
}

/** 만든 뒤 알릴 한 줄 */
const madeLine = () => L.config.envFileMade({ names: FILL_BY_HAND.join(", ") });

export { setupEnv, loadEnv, fillLine, madeLine, FILL_BY_HAND, LAUNCHER_ONLY };
