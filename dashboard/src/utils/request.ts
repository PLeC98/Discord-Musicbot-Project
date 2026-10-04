// 요청 한 곳. 화면의 모든 axios 요청이 이 가로채기를 거친다: CSRF 토큰 · 토큰 거절 뒤 한 번 다시 보내기 · 세션 끝 · 시간 한도
// 시간 한도는 종류별이다. 기본은 조작 · 읽기 · 저장(10초), 부르기 · 곡 넣기 · 더 넣기와 운영자의 오래 걸리는 일은 120초,
// 바깥 AI 를 부르는 운영자 시험은 서버의 AI 설정이 한도를 정하므로 화면은 걸지 않는다(0)

import type { AxiosInstance, InternalAxiosRequestConfig } from "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    /** 401 이어도 세션 끝으로 돌리지 않는다(로그인을 묻는 요청 · 로그아웃) */
    quietSession?: boolean;
    /** CSRF 토큰 거절 뒤 다시 보낸 요청(한 번만 다시 보낸다) */
    csrfRetried?: boolean;
  }
}

export const LIMIT = { short: 10_000, long: 120_000, none: 0 };

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// 봇 앞의 프록시가 봇에 닿지 못했을 때 내는 상태. 봇이 낸 것이면 문제 응답(code)이 실린다
const GATEWAY = new Set([502, 503, 504]);

/** 요청 오류에서 읽는 칸. axios 오류가 아닌 것이 와도 읽을 수 있는 것만 읽는다 */
type Failed = { response?: { status?: number; data?: unknown }; code?: string; config?: InternalAxiosRequestConfig };
const failedOf = (error: unknown): Failed => (error && typeof error === "object" ? (error as Failed) : {});

/** 요청 오류의 HTTP 상태. 응답이 없으면 undefined */
export const statusOf = (error: unknown): number | undefined => failedOf(error).response?.status;

/** 요청 오류의 응답 본문. 응답이 없으면 undefined */
export const replyOf = (error: unknown): unknown => failedOf(error).response?.data;

/** 응답 본문의 문제 코드. 문제 응답이 아니면 undefined */
export function problemCodeOf(data: unknown): string | undefined {
  const code = data && typeof data === "object" ? (data as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** 봇에게서 답을 못 받은 요청의 종류 */
export type FailureKind = "timeout" | "offline" | "aborted";

/** 봇에게서 답을 못 받은 요청의 종류. 시간 한도 · 연결 안 됨(프록시의 502 · 503 · 504 포함) · 화면이 끊음(페이지를 떠남 등) · 그 밖(봇이 답했다)은 null */
export function failureKind(error: unknown): FailureKind | null {
  const { response, code } = failedOf(error);
  if (response) return response.status !== undefined && GATEWAY.has(response.status) && problemCodeOf(response.data) === undefined ? "offline" : null;
  if (code === "ETIMEDOUT") return "timeout";
  if (code === "ERR_NETWORK") return "offline";
  if (code === "ECONNABORTED" || code === "ERR_CANCELED") return "aborted";
  return null;
}

/**
 * http(axios) 에 가로채기를 건다.
 * onSessionEnd: 401 을 받았을 때. 요청은 그대로 실패한다(부른 쪽이 처리 중을 푼다).
 * 요청에 quietSession 을 주면 401 이어도 부르지 않는다(로그아웃).
 * onReach(ok): 서버에 닿았는지(응답이 왔다 · 연결이 안 됐다). 시간 한도 · 끊음은 알리지 않는다
 */
export function installRequests(http: AxiosInstance, { onSessionEnd, onReach }: { onSessionEnd: () => void; onReach: (ok: boolean) => void }): void {
  let token: string | null = null;
  let tokenRequest: Promise<string> | null = null;

  http.defaults.withCredentials = true;
  http.defaults.timeout = LIMIT.short;
  // 시간 한도를 연결 끊김(ECONNABORTED)과 가르려고 ETIMEDOUT 으로 받는다
  http.defaults.transitional = { ...http.defaults.transitional, clarifyTimeoutError: true };

  function csrfToken(): Promise<string> {
    if (token) return Promise.resolve(token);
    tokenRequest ??= http
      .get<{ csrfToken: string }>("/api/csrf-token", { quietSession: true })
      .then((res) => (token = res.data.csrfToken))
      .finally(() => (tokenRequest = null));
    return tokenRequest;
  }

  http.interceptors.request.use(async (request) => {
    if (!UNSAFE.has((request.method || "GET").toUpperCase())) return request;
    try {
      request.headers["X-CSRF-Token"] = await csrfToken();
    } catch (error) {
      // 토큰을 못 받은 실패는 이 요청의 실패다(세션 끝이면 이 요청의 quietSession 을 따른다). 같은 토큰 요청을 기다린 다른 요청과 오류를 나눠 쓰지 않게 복사한다
      throw Object.assign(Object.create(Object.getPrototypeOf(error)), error, { config: request });
    }
    return request;
  });

  http.interceptors.response.use(
    (res) => {
      onReach(true);
      return res;
    },
    (error: unknown) => {
      const { response, config: request } = failedOf(error);
      if (failureKind(error) === "offline") onReach(false);
      else if (response) onReach(true);
      // 토큰은 처리기보다 앞에서 거절되므로 다시 보내도 같은 일이 두 번 되지 않는다. 새 토큰으로 정확히 한 번만
      if (problemCodeOf(response?.data) === "bad-csrf-token") {
        token = null;
        if (request && !request.csrfRetried) return http.request({ ...request, csrfRetried: true });
      }
      if (response?.status === 401 && !request?.quietSession) onSessionEnd();
      return Promise.reject(error);
    },
  );
}
