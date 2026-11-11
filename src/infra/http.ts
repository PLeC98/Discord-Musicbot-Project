// 외부 서비스로 나가는 HTTP 요청은 모두 이 클라이언트를 지난다. 서비스마다 부른 결과를 infra/link-status 에 남긴다.
// fetch는 응답을 받으면 성공(4xx는 요청의 문제라 성공으로 친다). 5xx, 429, 401, 403(키, 권한이 막혀 쓸 수 없다), 연결 실패, 시간 초과는 실패.
// 상태 코드만으로 판정할 수 없는 서비스는 read로 부르고 응답을 읽어 판정한다.
// 부른 쪽이 스스로 끊은 것(AbortError)은 서비스 쪽 문제가 아니라 남기지 않는다

import { record, type Service } from "./link-status.ts";

type Fetch = typeof fetch;

/** 응답을 읽어 매긴 결과. error가 있으면 실패(짧은 까닭) */
type Judged<T> = { value: T; error: string | null };

/** 4xx 중 실패로 치는 것: 너무 많이 부름, 키가 틀림, 권한 없음 */
const FAILED_STATUS = new Set([429, 401, 403]);

/** 실패의 짧은 까닭: 시간 초과, 연결 오류 코드(undici 는 cause 에 둔다), 이름 */
function reasonOf(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "timeout";
  const code = (error.cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown }).code;
  return typeof code === "string" ? code : error.name;
}

/** service 로 부르는 클라이언트. useFetch 는 테스트가 가짜 전송을 넣는 곳(null 이면 진짜 fetch) */
function httpFor(service: Service) {
  let transport: Fetch | null = null;

  function since(started: number) {
    return Math.round(performance.now() - started);
  }

  function noteThrown(error: unknown, started: number) {
    if (!(error instanceof Error && error.name === "AbortError")) record(service, { ok: false, ms: since(started), error: reasonOf(error) });
  }

  async function send(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const started = performance.now();
    let res: Response;
    try {
      res = await (transport ?? fetch)(input, init);
    } catch (error) {
      noteThrown(error, started);
      throw error;
    }
    const failed = res.status >= 500 || FAILED_STATUS.has(res.status);
    record(service, { ok: !failed, ms: since(started), error: failed ? `HTTP ${res.status}` : null });
    return res;
  }

  /** 응답을 judge로 읽어 판정한다. 보낼 때는 남기지 않고, 판정, 본문 읽기 실패, 던짐 어느 경우에도 한 번 남긴다 */
  async function read<T>(input: string | URL | Request, init: RequestInit | undefined, judge: (res: Response) => Promise<Judged<T>>): Promise<T> {
    const started = performance.now();
    let judged: Judged<T>;
    try {
      judged = await judge(await (transport ?? fetch)(input, init));
    } catch (error) {
      noteThrown(error, started);
      throw error;
    }
    record(service, { ok: !judged.error, ms: since(started), error: judged.error });
    return judged.value;
  }

  return {
    fetch: send,
    read,
    useFetch(fake: Fetch | null) {
      transport = fake;
    },
  };
}

type HttpClient = ReturnType<typeof httpFor>;

export { httpFor, reasonOf };
export type { HttpClient, Judged };
