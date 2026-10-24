// 판정: 이 오류는 어떤 종류인가. 종류 이름을 낸다. 문장은 ui/error-messages 가 만든다.
// 오류를 만든 곳이 이름(code)을 붙인다(codedError). 여기서는 그 이름을 본다: 오류 자신부터 원인(cause) 사슬을 따라가며, 종류 · 시스템 · 디스코드 이름 순으로.
// 글은 보지 않는다. 이름이 없으면 unknown-error 다. 우리가 못 고치는 문장(yt-dlp 출력)은 그 출처(sources/youtube/errors)가 읽어 이름을 붙인다.

import { isCode, type Code } from "./problems.ts";
import { codeOf, messageOf } from "../infra/error-text.ts";

// 이름이 곧 종류인 것. 오류를 만든 곳이 붙인다
const KINDS = new Set<Code>(["yt-age-cookies-invalid", "yt-age-no-cookies", "age-content-off", "age-channel-only", "yt-bot-check", "unavailable-contents", "sc-preview-only", "unavailable-playlist", "geo-blocked", "rate-limited", "sp-no-youtube-match", "direct-unavailable", "network-error", "stream-failed", "voice-failed"]);
// 연결이 끊기거나 닿지 않은 것(Node · undici 가 붙이는 이름)
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);
// 디스코드 API 오류 번호. 50001 접근 없음 · 50013 권한 없음
const PERMISSION_CODES = new Set([50001, 50013]);

/** 코드를 단 오류. 만든 곳이 무엇이 안 됐는지 안다 */
function codedError(code: string, message: string, options?: { cause?: unknown }) {
  return Object.assign(new Error(message, options), { code });
}

/** 로그에 싣는 오류: 메시지와 코드(있으면) */
function describeError(error: unknown): string {
  const code = codeOf(error);
  return `${messageOf(error)}${code === undefined ? "" : ` (${code})`}`;
}

// 디스코드가 권한 없음으로 거절한 요청. 거절된 요청의 주소로 구분한다: 음성 채널 상태는 음성, 메시지 · 고정 · 웹훅은 글, 그 밖.
// 음성 채널 접속은 게이트웨이로 가 이 번호를 받지 않는다(접속 전에 권한을 본다. usecases/permissions)
function permissionKind(one: object) {
  const url = "url" in one && typeof one.url === "string" ? one.url : "";
  if (/\/channels\/\d+\/voice-status\b/.test(url)) return "permission-voice";
  if (/\/channels\/\d+\/(?:messages|pins)\b|\/webhooks\//.test(url)) return "permission-text";
  return "permission-other";
}

// 오류 하나의 이름을 종류로. 모르는 이름이면 null
function kindOf(one: object): Code | null {
  const code = codeOf(one);
  if (typeof code === "number") return PERMISSION_CODES.has(code) ? permissionKind(one) : null;
  if (!code) return null;
  if (isCode(code) && KINDS.has(code)) return code;
  if (NETWORK_CODES.has(code) || code.startsWith("UND_ERR_")) return "network-error";
  return null;
}

// 원인 사슬. 가까운 것부터 몇 겹만(fetch 오류는 원인의 원인에 시스템 이름이 붙는다)
function chainOf(error: unknown, depth = 4): unknown[] {
  const out: unknown[] = [];
  let one = error;
  while (one && typeof one === "object" && out.length < depth) {
    out.push(one);
    one = "cause" in one ? one.cause : undefined;
  }
  return out;
}

/** 오류의 종류. 문제 목록(rules/problems)의 코드다 */
function errorKind(error: unknown): Code {
  const chain = chainOf(error);
  for (const one of chain) {
    const coded = kindOf(one as object);
    if (coded) return coded;
  }
  // AbortSignal.timeout 이 끊은 요청. (음성 연결의 기다림이 끝난 것은 AbortError 라 여기 들지 않는다)
  if (chain.some((one) => "name" in (one as object) && (one as { name?: unknown }).name === "TimeoutError")) return "network-error";
  return "unknown-error";
}

export { errorKind, codedError, codeOf, messageOf, describeError };
