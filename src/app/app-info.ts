// 봇 토큰의 앱 설정(GET /applications/@me). 기동이 한 번 읽어 앱 ID 대조와 특권 인텐트 고르기(app/privileged-intents)가 같은 결과를 쓴다.
// 못 읽으면 대조를 건너뛰고 특권 인텐트를 모두 요청한다(모르는 것은 틀린 것이 아니다). 명령 배포가 실패하면 그 안내가 원인을 짚는다(app/command-loader)

import { REST, Routes } from "discord.js";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import type { AppFlags } from "../infra/gateway-intents.ts";

const log = logger.child({ category: "core" });

/** 앱 설정 조회의 타임아웃. 디스코드에 닿지 않아도 기동이 오래 늦어지지 않게 재시도하지 않는다(디스코드를 기다리는 것은 로그인 앞의 게이트웨이 조회가 한다) */
const READ_TIMEOUT_MS = 5000;

/** 봇 토큰으로 앱 설정을 읽는다 */
function readApp(token: string): Promise<AppFlags> {
  const rest = new REST({ version: "10", timeout: READ_TIMEOUT_MS, retries: 0 }).setToken(token);
  return rest.get(Routes.currentApplication()) as Promise<AppFlags>;
}

/** 앱 설정을 읽는다. 못 읽으면 경고하고 null. read: 읽는 것(테스트가 넘긴다) */
async function readAppOnce(read: () => Promise<AppFlags>): Promise<AppFlags | null> {
  try {
    return await read();
  } catch (error) {
    log.warn(`앱 설정을 읽지 못해 앱 ID 대조를 건너뛰고 특권 인텐트를 모두 요청함: ${messageOf(error)}`);
    return null;
  }
}

/**
 * CLIENT_ID가 봇 토큰의 앱이 아니면 그 안내, 맞거나 모르면 null.
 * 틀리면 명령 배포가 거절되고, 초대 링크가 다른 앱을 가리키고, 대시보드 로그인이 다른 앱으로 간다
 */
function clientIdMismatch(app: AppFlags | null, clientId: string): string | null {
  const id = app?.id;
  if (typeof id !== "string" || id === clientId) return null;
  return `CLIENT_ID(${clientId})가 봇 토큰의 앱(${id})이 아님. 개발자 포털의 Application ID와 .env의 CLIENT_ID가 같은지 확인하세요`;
}

export { readApp, readAppOnce, clientIdMismatch, READ_TIMEOUT_MS };
