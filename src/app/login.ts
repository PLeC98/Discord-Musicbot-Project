// 디스코드 로그인. 디스코드 5xx · 네트워크 오류로 실패하면 간격을 두고 다시 해 본다(로그인 전이라 잃을 상태가 없다).
// 토큰 · 인텐트가 틀린 것은 다시 해도 같으니 곧바로 던진다. 다 해 봐도 안 되면 던진다(부른 쪽이 일시적 기동 실패로 내린다).
// discord.js 는 로그인이 실패하면 스스로 클라이언트를 정리하므로 같은 클라이언트로 다시 할 수 있다.

import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/errorKind.ts";
import { EXIT, failedStartCode } from "./exitCodes.ts";

const log = logger.child({ category: "core" });

/** 다시 하기 전 기다림. 길이가 곧 다시 하는 횟수다 */
const LOGIN_RETRY_MS = [5_000, 15_000, 30_000, 60_000];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function loginWithRetry(client: { login(token: string): Promise<unknown> }, token: string, { waits = LOGIN_RETRY_MS, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.login(token);
    } catch (error) {
      if (failedStartCode(error, false) === EXIT.badSetup || attempt >= waits.length) throw error;
      log.warn(`디스코드 로그인 실패: ${messageOf(error)} | ${waits[attempt] / 1000}초 뒤 다시 합니다 (${attempt + 1}/${waits.length})`);
      await wait(waits[attempt]);
    }
  }
}

export { loginWithRetry, LOGIN_RETRY_MS };
