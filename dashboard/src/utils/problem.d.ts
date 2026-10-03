// problem.js 의 모양(봇 쪽 시험이 부를 때 쓴다)

type RequestError = { response?: { data?: unknown } } | null | undefined;

export function problemText(error: RequestError, fallback: string): string;
export function problemDetails(error: RequestError): string[];
export function problemCode(error: RequestError): string | null;
