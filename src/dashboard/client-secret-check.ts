// 기동할 때 CLIENT_SECRET이 맞는지 디스코드에 확인한다. 틀리면 아무도 대시보드에 로그인하지 못하는데, 지금은 누가 로그인해 봐야 드러난다.
// 확인할 때는 토큰 폐기(RFC 7009)에 매번 새로 만든 가짜 토큰을 보낸다. 폐기는 먼저 클라이언트 인증을 검사하고(틀리면 401 invalid_client, RFC 6749 5.2),
// 토큰이 틀려도 200을 돌려준다. 진짜 토큰이 발급되지 않고(client credentials는 봇 주인 계정의 토큰을 발급한다) 아무것도 폐기되지 않는다.
// 맞음이나 틀림이 나오면 멈춘다. 바뀔 수 있는 실패(시간 초과, 연결 실패, 429, 5xx)만 1, 2, 4, 8분 뒤 다시 시도하고, 바뀌지 않는 답(400, 403, 다른 401)은 바로 알린다.
// 401을 되풀이하면 디스코드의 무효 요청 제한(IP당 10분 1만 번)에 누적되므로 주기적으로 다시 확인하지 않는다. 기동은 멈추지 않는다(음악 기능은 시크릿과 상관없다).
// 로그에는 상태 코드와 디스코드의 error 값만 남긴다(시크릿, 요청 본문, 응답 전체는 남기지 않는다)

import crypto from "node:crypto";
import logger from "../infra/log/logger.ts";
import { L } from "../infra/log/text.ts";
import { discordHttp, type DiscordHttp } from "./discord-api.ts";
import { isBadClient, revokeToken } from "./oauth-client.ts";

const log = logger.child({ category: "dashboard" });

/** 확인에 실패했을 때 다시 시도하기까지의 대기 시간(ms). 첫 시도를 포함해 모두 5번 */
const RETRY_MS = [60_000, 120_000, 240_000, 480_000];

/** ok: 맞음, wrong: 틀림, fixed: 바뀌지 않는 다른 답(다시 해도 같다), later: 바뀔 수 있는 실패(다시 한다). waitMs: 디스코드가 기다리라고 한 시간 */
type Verdict = { kind: "ok" } | { kind: "wrong" } | { kind: "fixed"; status: number; error: string | null } | { kind: "later"; status: number | null; error: string | null; waitMs: number | null };

type Failure = { response?: { status?: number; data?: unknown }; name?: string; message?: string };

/** 디스코드 응답 본문의 error 값(문자열일 때만) */
const errorOf = (data: unknown) => (typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null);

/** 429 본문의 retry_after(초)를 ms로. 없으면 null */
function retryAfterMs(data: unknown) {
  const after = (data as { retry_after?: unknown } | undefined)?.retry_after;
  return typeof after === "number" && after > 0 ? Math.ceil(after * 1000) : null;
}

/** 응답 없는 실패(시간 초과, 연결 실패)는 다시 시도한다 */
function noAnswer({ name, message }: Failure): Verdict {
  return { kind: "later", status: null, error: name === "TimeoutError" ? "timeout" : (message ?? null), waitMs: null };
}

/** 폐기 요청의 실패를 판정으로 바꾼다. 응답이 있으면 상태 코드로 판정하고, 없으면 다시 시도한다 */
function verdictOf(error: unknown): Verdict {
  const failure = (typeof error === "object" && error !== null ? error : {}) as Failure;
  const { response } = failure;
  const status = response?.status;
  if (status === undefined) return noAnswer(failure);
  if (status === 401 && isBadClient(response)) return { kind: "wrong" };
  const code = errorOf(response?.data);
  if (status === 429 || status >= 500) return { kind: "later", status, error: code, waitMs: status === 429 ? retryAfterMs(response?.data) : null };
  return { kind: "fixed", status, error: code };
}

/** 시크릿을 한 번 확인한다. 가짜 토큰은 매번 새로 만든다 */
async function checkClientSecret(http: DiscordHttp = discordHttp): Promise<Verdict> {
  try {
    await revokeToken(http, crypto.randomBytes(32).toString("base64url"));
    return { kind: "ok" };
  } catch (error) {
    return verdictOf(error);
  }
}

type Timers = { setTimeout: (run: () => void, ms: number) => { unref?: () => unknown } };

/** 대시보드를 시작할 때 부른다. http, timers: 테스트가 넘긴다(테스트가 디스코드에 시크릿을 보내지 않게). 끝나면(맞음, 틀림, 바뀌지 않는 답, 다섯 번 실패) 판정을 돌려준다 */
function startClientSecretCheck(http: DiscordHttp = discordHttp, timers: Timers = globalThis): Promise<Verdict> {
  return new Promise((resolve) => {
    const attempt = (tries: number) => {
      void checkClientSecret(http).then((verdict) => {
        if (verdict.kind === "ok") log.info(L.dashboard.clientSecretOk());
        else if (verdict.kind === "wrong") log.error(L.dashboard.clientSecretWrong());
        else if (verdict.kind === "fixed") log.warn(L.dashboard.clientSecretUnexpected({ status: verdict.status, error: verdict.error }));
        else if (tries < RETRY_MS.length) {
          const wait = Math.max(RETRY_MS[tries], verdict.waitMs ?? 0);
          log.debug(L.dashboard.clientSecretRetry({ status: verdict.status, error: verdict.error, seconds: Math.round(wait / 1000) }));
          // 프로세스를 붙잡지 않는다(꺼질 때 기다리지 않게)
          timers.setTimeout(() => attempt(tries + 1), wait).unref?.();
          return;
        } else log.warn(L.dashboard.clientSecretGaveUp({ status: verdict.status, error: verdict.error }));
        resolve(verdict);
      });
    };
    attempt(0);
  });
}

export { checkClientSecret, startClientSecretCheck, verdictOf, RETRY_MS };
export type { Verdict };
