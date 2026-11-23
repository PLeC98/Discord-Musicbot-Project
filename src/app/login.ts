// 디스코드 로그인. 로그인 전에 게이트웨이 정보(GET /gateway/bot)를 먼저 조회하고, 디스코드 5xx, 네트워크 오류면 간격을 두고 재시도한다.
// 기동 시의 5xx는 대개 이 요청에서 난다. 이 요청은 클라이언트 상태를 건드리지 않아 몇 번이든 재시도해도 된다.
//
// 로그인 자체는 한 번만 한다. discord.js 14.27은 로그인이 실패하면 자체적으로 destroy() 해 캐시 청소 타이머를 끄고
// 게이트웨이 관리자를 destroyed로 둔다(Client.js login, WebSocketManager.js destroy). 그 뒤로 다시 로그인은 되지만,
// 종료 때의 destroy()가 게이트웨이 연결을 닫지 못하고 청소 타이머도 돌아오지 않는다. 그래서 로그인이 실패하면 예외를 던진다(일시적 기동 실패).

import { Routes } from "discord.js";
import logger from "../infra/log/logger.ts";
import { codedError, messageOf } from "../rules/error-kind.ts";
import { EXIT, failedStartCode } from "./exit-codes.ts";
import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";

const log = logger.child({ category: "core" });

/** 재시도 전 대기(ms). 길이가 곧 재시도 횟수다 */
const GATEWAY_RETRY_MS = [5_000, 15_000, 30_000, 60_000];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type LoginClient = { rest: { setToken(token: string): unknown; get(route: string): Promise<unknown> }; login(token: string): Promise<unknown> };

/** 재시도 간격. waits: 재시도 전 대기(ms), wait: 기다리는 것(테스트가 넘긴다) */
type Retry = { waits?: number[]; wait?: (ms: number) => Promise<unknown> };

/**
 * 디스코드가 답할 때까지 간격을 두고 재시도한다. 토큰이 틀리면(401) 곧바로 TokenInvalid를 던지고, 재시도를 다 쓰면 마지막 오류를 던진다.
 * 상태를 바꾸지 않는 조회에만 쓴다(게이트웨이 정보, 앱 설정). what: 로그에 쓰는 이름
 */
async function untilDiscordAnswers<T>(what: string | LogText, call: () => Promise<T>, { waits = GATEWAY_RETRY_MS, wait = sleep }: Retry = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 401) throw codedError("TokenInvalid", L.core.discordTokenInvalid(), { cause: error });
      if (failedStartCode(error, false) === EXIT.badSetup || attempt >= waits.length) throw error;
      log.warn(L.core.discordCallRetrying({ what, error: messageOf(error), seconds: waits[attempt] / 1000, attempt: attempt + 1, maxAttempts: waits.length }));
      await wait(waits[attempt]);
    }
  }
}

async function loginWithRetry(client: LoginClient, token: string, retry: Retry = {}) {
  client.rest.setToken(token);
  await untilDiscordAnswers(L.core.gatewayInfoFetch(), () => client.rest.get(Routes.gatewayBot()), retry);
  return client.login(token);
}

export { loginWithRetry, untilDiscordAnswers, GATEWAY_RETRY_MS };
export type { Retry };
