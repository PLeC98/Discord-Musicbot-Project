// 봇 토큰의 앱 설정(GET /applications/@me). 기동과 pnpm commands가 먼저 읽어 앱 ID를 넣고(infra/app-id), 기동은 같은 결과로 특권 인텐트를 고른다(app/privileged-intents).
// 앱 ID는 .env에 두지 않는다: 토큰이 정하는 값이라 따로 적으면 틀릴 수 있다. 토큰을 디코딩해 쓰지 않는다(Discord가 형식을 보장하지 않는다).
// 디스코드가 답할 때까지 로그인과 같은 간격으로 재시도하고(app/login), 토큰이 틀리면(401) 멈춘다

import { REST, Routes } from "discord.js";
import { codedError } from "../rules/error-kind.ts";
import { useAppId } from "../infra/app-id.ts";
import type { AppFlags } from "../infra/gateway-intents.ts";
import { untilDiscordAnswers, type Retry } from "./login.ts";
import { L } from "../infra/log/text.ts";

/** 조회 한 번의 타임아웃. 재시도는 간격을 두고 따로 한다 */
const READ_TIMEOUT_MS = 5000;

/** 봇 토큰으로 앱 설정을 읽는다 */
function readApp(token: string): Promise<AppFlags> {
  const rest = new REST({ version: "10", timeout: READ_TIMEOUT_MS, retries: 0 }).setToken(token);
  return rest.get(Routes.currentApplication()) as Promise<AppFlags>;
}

/** 앱 설정을 읽어 앱 ID를 넣고 돌려준다. 앱 ID가 없는 답은 빈 값으로 넣지 않고 예외를 던진다. read, retry: 테스트가 넘긴다 */
async function loadApp(read: () => Promise<AppFlags>, retry: Retry = {}): Promise<AppFlags> {
  const app = await untilDiscordAnswers(L.core.appSettingsFetch(), read, retry);
  if (typeof app.id !== "string" || !app.id) throw codedError("app-id-missing", L.core.appIdMissing());
  useAppId(app.id);
  return app;
}

export { readApp, loadApp, READ_TIMEOUT_MS };
