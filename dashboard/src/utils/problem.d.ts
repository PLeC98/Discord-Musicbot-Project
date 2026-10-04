// problem.js 의 모양(봇 쪽 시험이 부를 때 쓴다)

type RequestError = { response?: { data?: unknown; status?: number }; code?: string } | null | undefined;
type ProblemNotice = { title: string; body: string; detail: string; code: string | null; severity: "error" | "warning" };

export function problemNotice(error: RequestError, fallback: string): ProblemNotice;
export function problemText(error: RequestError, fallback: string): string;
export function problemDetails(error: RequestError): string[];
