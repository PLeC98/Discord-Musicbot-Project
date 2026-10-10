// 바깥 서비스로 나가는 HTTP 요청은 모두 이 클라이언트를 지난다. 서비스마다 부른 결과를 infra/link-status 에 남긴다.
// 응답을 받으면 성공(4xx 는 요청의 문제라 성공으로 친다), 5xx · 429 · 연결 실패 · 시간 초과는 실패.
// 부른 쪽이 스스로 끊은 것(AbortError)은 서비스의 일이 아니라 남기지 않는다

import { record, type Service } from "./link-status.ts";

type Fetch = typeof fetch;

/** 실패의 짧은 까닭: 시간 초과 · 연결 오류 코드(undici 는 cause 에 둔다) · 이름 */
function reasonOf(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "timeout";
  const code = (error.cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown }).code;
  return typeof code === "string" ? code : error.name;
}

/** service 로 부르는 클라이언트. useFetch 는 시험이 가짜 전송을 넣는 자리(null 이면 진짜 fetch) */
function httpFor(service: Service) {
  let transport: Fetch | null = null;

  async function send(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    let res: Response;
    try {
      res = await (transport ?? fetch)(input, init);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) record(service, { ok: false, ms: ms(), error: reasonOf(error) });
      throw error;
    }
    const failed = res.status >= 500 || res.status === 429;
    record(service, { ok: !failed, ms: ms(), error: failed ? `HTTP ${res.status}` : null });
    return res;
  }

  return {
    fetch: send,
    useFetch(fake: Fetch | null) {
      transport = fake;
    },
  };
}

type HttpClient = ReturnType<typeof httpFor>;

export { httpFor };
export type { HttpClient };
