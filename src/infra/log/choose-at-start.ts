// .env를 읽지 않는 진입 파일(scripts의 setup-config, launch, check-bot-stopped, 빌드 도구 등)의 첫 줄. 로그 언어를 고른다.
// .env에서 LOG_LANGUAGE 한 줄만 읽고 process.env에는 올리지 않는다. 실행기는 { ...process.env }로 봇을 띄우므로, 올리면 다시 시작해도 고친 .env가 봇에 반영되지 않는다.
// 셸 환경이 .env보다 앞선다(process.loadEnvFile과 같은 차례). .env를 읽는 진입은 app/env-bootstrap이 읽은 바로 뒤에 고른다

import fs from "node:fs";
import { parseEnv } from "node:util";
import { PROJECT } from "../project-paths.ts";
import { chooseLogLanguage } from "./choose-language.ts";

/** .env에 적은 LOG_LANGUAGE. 파일이 없거나 못 읽으면 undefined */
function fromEnvFile(): string | undefined {
  try {
    return parseEnv(fs.readFileSync(PROJECT.env, "utf8")).LOG_LANGUAGE;
  } catch {
    return undefined;
  }
}

chooseLogLanguage({ LOG_LANGUAGE: "LOG_LANGUAGE" in process.env ? process.env.LOG_LANGUAGE : fromEnvFile() });
