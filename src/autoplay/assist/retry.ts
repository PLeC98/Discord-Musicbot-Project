/**
 * AI 보조가 실패한 부르기를 다시 할지, 얼마나 기다릴지. 부르는 일은 하지 않는다(index.ts 의 askBatch).
 */

/** 거절 응답에서 읽는 필드. 규격마다 이름이 다르다(Google status · Anthropic type · OpenAI code) */
type ErrorBody = { error?: { status?: unknown; type?: unknown; code?: unknown; message?: unknown; details?: unknown } };
type HeaderSource = { get(name: string): string | null } | null | undefined;

// 풀릴 때까지 계속 실패하는 한도. 429 로 오지만 다시 해도 소용없다(Anthropic 지출 상한 · OpenAI 크레딧 소진)
const EXHAUSTED = /enforced_spend_limit_reached|insufficient_quota/;

function readBody(text: string): ErrorBody["error"] {
  try {
    const parsed = JSON.parse(text) as ErrorBody;
    return parsed && typeof parsed === "object" && parsed.error && typeof parsed.error === "object" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 거절 응답의 까닭. key 는 같은 실패끼리 같은 글이 되게 상태 코드와 오류 이름만(문구에는 요청 id · 초가 섞인다),
 * detail 은 저쪽이 적어 보낸 문구
 */
function summaryOf(status: number, text: string) {
  const error = readBody(text);
  const name = [error?.status, error?.type, error?.code].find((one) => typeof one === "string" && one);
  const message = typeof error?.message === "string" ? error.message : text;
  return { key: `HTTP ${status}${name ? ` ${name}` : ""}`, detail: message.replace(/\s+/g, " ").trim().slice(0, 300) };
}

/** 다시 해도 소용없는 한도 소진인가 */
const exhausted = (text: string) => EXHAUSTED.test(text);

// "34s" · "1.5s" (proto Duration)
function durationMs(text: unknown) {
  const got = typeof text === "string" && /^(\d+(?:\.\d+)?)s$/.exec(text.trim());
  return got ? Math.round(Number(got[1]) * 1000) : null;
}

/**
 * 저쪽이 기다리라고 한 시간(밀리초). 없으면 null.
 * Retry-After(초 또는 날짜) · retry-after-ms 헤더, 제미니 API 는 헤더 없이 본문의 RetryInfo.retryDelay 에 적는다. 여럿이면 긴 것
 */
function adviceMs(headers: HeaderSource, text: string, now = Date.now()) {
  const details = readBody(text)?.details;
  const fromBody = (Array.isArray(details) ? details : []).map((one) => durationMs((one as { retryDelay?: unknown } | null)?.retryDelay));
  const found = [...headerAdvice(headers, now), ...fromBody].filter((one): one is number => one !== null);
  return found.length ? Math.max(...found) : null;
}

function headerAdvice(headers: HeaderSource, now: number) {
  const ms = headers?.get("retry-after-ms")?.trim();
  const after = headers?.get("retry-after")?.trim();
  const found: number[] = [];
  if (ms && /^\d+(\.\d+)?$/.test(ms)) found.push(Math.round(Number(ms)));
  if (after && /^\d+(\.\d+)?$/.test(after)) found.push(Math.round(Number(after) * 1000));
  else if (after && Number.isFinite(Date.parse(after))) found.push(Math.max(0, Date.parse(after) - now));
  return found;
}

/** n 번째 재시도 앞의 대기. 두 배씩 늘려 상한까지, 절반은 무작위로 흔든다(여럿이 같은 때 몰리지 않게) */
function backoffMs(n: number, firstMs: number, maxMs: number, random = Math.random) {
  const full = Math.min(maxMs, firstMs * 2 ** (n - 1));
  return Math.round(full / 2 + (random() * full) / 2);
}

export { summaryOf, exhausted, adviceMs, backoffMs };
