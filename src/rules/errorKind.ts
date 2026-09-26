// 판정: 이 오류는 어떤 종류인가. 종류 이름을 낸다. 문장은 ui/errorMessages 가 만든다.
// 오류를 만든 곳이 이름(code)을 붙인다(codedError). 여기서는 그 이름을 본다: 오류 자신부터 원인(cause) 사슬을 따라가며, 종류 · 시스템 · 디스코드 이름 순으로.
// 글은 보지 않는다. 이름이 없으면 unknown 이다. 우리가 못 고치는 문장(yt-dlp 출력)은 그 출처(sources/youtube/errors)가 읽어 이름을 붙인다.

// 이름이 곧 종류인 것. 오류를 만든 곳이 붙인다
const KINDS = new Set(["age-cookies-invalid", "age-restricted", "bot-check", "video-unavailable", "playlist-unavailable", "geo-blocked", "rate-limited", "no-youtube-match", "spotify-unavailable", "link-unavailable", "network", "stream-failed", "voice-permission"]);
// 연결이 끊기거나 닿지 않은 것(Node · undici 가 붙이는 이름)
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);
// 디스코드 API 오류 번호. 50001 접근 없음 · 50013 권한 없음
const DISCORD_KINDS: Record<number, string> = { 50001: "voice-permission", 50013: "voice-permission" };

/** 코드를 단 오류. 만든 곳이 무엇이 안 됐는지 안다 */
function codedError(code: string, message: string, options?: { cause?: unknown }) {
  return Object.assign(new Error(message, options), { code });
}

/** 오류가 달고 온 이름(code). 글자도 수도 온다(디스코드 API 는 수) */
function codeOf(error: unknown): string | number | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

/** 알릴 오류 글. 글이 없으면 fallback(주지 않으면 값을 그대로 글로) */
function messageOf(error: unknown, fallback = String(error)): string {
  const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
  return (typeof message === "string" && message) || fallback;
}

// 이름 하나를 종류로. 모르는 이름이면 null
function kindOfCode(code: string | number | undefined): string | null {
  if (typeof code === "number") return DISCORD_KINDS[code] ?? null;
  if (!code) return null;
  if (KINDS.has(code)) return code;
  if (NETWORK_CODES.has(code) || code.startsWith("UND_ERR_")) return "network";
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

function errorKind(error: unknown): string {
  const chain = chainOf(error);
  for (const one of chain) {
    const coded = kindOfCode(codeOf(one));
    if (coded) return coded;
  }
  // AbortSignal.timeout 이 끊은 요청. (음성 연결의 기다림이 끝난 것은 AbortError 라 여기 들지 않는다)
  if (chain.some((one) => "name" in (one as object) && (one as { name?: unknown }).name === "TimeoutError")) return "network";
  return "unknown";
}

export { errorKind, codedError, codeOf, messageOf };
