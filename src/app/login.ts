// 디스코드 로그인. 로그인 전에 게이트웨이 정보(GET /gateway/bot)를 먼저 물어보고, 디스코드 5xx · 네트워크 오류면 간격을 두고 다시 묻는다.
// 기동 때의 5xx 는 대개 이 요청에서 난다(운영 로그 7번 중 6번). 이 요청은 클라이언트 상태를 건드리지 않아 몇 번이든 다시 해도 된다.
//
// 로그인 자체는 한 번만 한다. discord.js 14.27 은 로그인이 실패하면 스스로 destroy() 해 캐시 청소 타이머를 끄고
// 게이트웨이 관리자를 destroyed 로 둔다(Client.js login · WebSocketManager.js destroy). 그 뒤로 다시 로그인은 되지만,
// 종료 때의 destroy() 가 게이트웨이 연결을 닫지 못하고 청소 타이머도 돌아오지 않는다. 그래서 로그인이 실패하면 던진다(일시적 기동 실패).

import { Routes } from "discord.js";
import logger from "../infra/log/logger.ts";
import { codedError, messageOf } from "../rules/errorKind.ts";
import { EXIT, failedStartCode } from "./exitCodes.ts";

const log = logger.child({ category: "core" });

/** 다시 묻기 전 기다림. 길이가 곧 다시 묻는 횟수다 */
const GATEWAY_RETRY_MS = [5_000, 15_000, 30_000, 60_000];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type LoginClient = { rest: { setToken(token: string): unknown; get(route: string): Promise<unknown> }; login(token: string): Promise<unknown> };

// 게이트웨이 정보를 물을 수 있을 때까지. 토큰이 틀리면(401) 곧바로 던진다
async function waitForGateway(client: LoginClient, waits: number[], wait: (ms: number) => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.rest.get(Routes.gatewayBot());
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 401) throw codedError("TokenInvalid", "디스코드 토큰이 틀렸습니다", { cause: error });
      if (failedStartCode(error, false) === EXIT.badSetup || attempt >= waits.length) throw error;
      log.warn(`디스코드 게이트웨이 정보를 받지 못했습니다: ${messageOf(error)} | ${waits[attempt] / 1000}초 뒤 다시 묻습니다 (${attempt + 1}/${waits.length})`);
      await wait(waits[attempt]);
    }
  }
}

async function loginWithRetry(client: LoginClient, token: string, { waits = GATEWAY_RETRY_MS, wait = sleep } = {}) {
  client.rest.setToken(token);
  await waitForGateway(client, waits, wait);
  return client.login(token);
}

export { loginWithRetry, GATEWAY_RETRY_MS };
