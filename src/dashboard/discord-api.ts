// 디스코드 REST(사용자 토큰으로 부르는 것: OAuth 로그인, 초대 화면의 서버 목록). 봇 토큰으로 부르는 것은 discord.js가 한다

import { L } from "../infra/log/text.ts";
import { logTextError } from "../infra/log/log-text.ts";

const DISCORD_API = "https://discord.com/api/v10";

// 응답 없는 요청이 로그인 콜백, 초대 화면을 붙잡지 않도록 제한 시간을 둔다
const TIMEOUT_MS = 10_000;

/** 디스코드 응답. 호출부가 모양(T)을 정한다 */
type Reply<T> = { data: T };
/** 디스코드를 부르는 HTTP 클라이언트. 2xx가 아니면 상태와 본문(response)을 실은 오류를 던진다 */
type DiscordHttp = {
  post<T>(url: string, body: URLSearchParams, init?: { headers?: Record<string, string> }): Promise<Reply<T>>;
  get<T>(url: string, init?: { headers?: Record<string, string> }): Promise<Reply<T>>;
};

async function call<T>(url: string, init: RequestInit): Promise<Reply<T>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // JSON이 아니면 텍스트 그대로
  }
  if (!res.ok) throw Object.assign(logTextError(L.net.httpStatus({ status: res.status })), { response: { status: res.status, data } });
  return { data: data as T };
}

const discordHttp: DiscordHttp = {
  post: (url, body, { headers } = {}) => call(url, { method: "POST", body, headers }),
  get: (url, { headers } = {}) => call(url, { headers }),
};

export { DISCORD_API, discordHttp };
export type { DiscordHttp };
