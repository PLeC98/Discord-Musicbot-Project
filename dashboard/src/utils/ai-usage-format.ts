// AI 리퀘스트 로그 · 사용량 통계의 표시 형식: 걸린 시간 · 비용 · 토큰 · 짧은 주소 · 원문 펴기

import { formatNumber } from "./locale.ts";

/** 1초 아래는 ms, 위는 소수 둘째 자리 초 */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "-";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/** 달러. 1센트 아래는 넷째 자리까지(작은 요청이 0 으로 보이지 않게), 0 은 그대로 */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${formatNumber(Number(usd.toFixed(2)))}`;
}

export const formatTokens = (n: number) => formatNumber(n);

/** 호스트와 경로(물음표 뒤는 뺀다). 못 읽으면 그대로 */
export function shortUrl(url: string): string {
  try {
    const one = new URL(url);
    return `${one.host}${one.pathname}`;
  } catch {
    return url;
  }
}

/** JSON 이면 들여 써서 편다. 아니면 그대로(잘린 원문 · 글 응답) */
export function prettyJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

/** "2026-08-31" → "8/31" */
export function dayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(month)}/${Number(date)}`;
}
