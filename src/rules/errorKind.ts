// 판정: 이 오류는 어떤 종류인가. 종류 이름을 낸다. 문장은 ui/errorMessages 가 만든다.
// 오류를 만든 곳이 이름(code)을 붙인다(codedError). 여기서는 그 이름을 먼저 본다: 오류 자신 → 원인(cause) → 시스템 · 디스코드 코드.
//
// 낱말 표(RULES)는 이름이 없는 오류의 마지막 길이다. 2단계에서 걷는다.
//
// 연령 제한이 봇 감지보다 앞이다. 연령 확인 문장("Sign in to confirm your age")이 봇 감지의 "sign in to confirm" 도
// 품고 있어서, 차례가 거꾸로면 연령 제한이 봇 감지로 가려진다.

// 글자(소문자로 찾는다) 또는 판정 함수
type Test = string | ((msg: string) => boolean);

const RULES: Array<[string, Test[]]> = [
  // 쿠키로 다시 시도했는데 쿠키가 무효였던 연령 제한. yt-dlp 가 원인을 WARNING 에, 결과를 ERROR 에 나눠 적는다
  ["age-cookies-invalid", [(m) => m.includes("cookies are no longer valid") && m.includes("confirm your age")]],
  ["age-restricted", ["age-restricted", "age restricted", "confirm your age", "only available to registered users"]],
  // YouTube 봇 감지 / 로그인 필요
  ["bot-check", ["sign in to confirm", "confirm you", "bot detection", "not a robot", "please sign in", "inappropriate", (m) => m.includes("youtube") && m.includes("403")]],
  // 비공개 / 삭제됨 / 사용할 수 없는 영상
  ["video-unavailable", ["private video", "video unavailable", "this video is unavailable", "this video has been removed", "no longer available", "has been deleted", "video is not available"]],
  ["geo-blocked", ["not available in your country", "geo", "blocked in", "region"]],
  ["rate-limited", ["429", "too many requests", "rate limit", "quota"]],
  // Spotify 트랙을 YouTube 에서 찾을 수 없음
  ["no-youtube-match", ["youtube equivalent not found", "no youtube match", "could not find youtube", "동등물"]],
  ["no-results", ["no results", "not found", "no entries", "no tracks"]],
  ["network", ["econnreset", "econnrefused", "etimedout", "fetch failed", "socket hang up", "network", "connection refused", "getaddrinfo"]],
  // FFmpeg / 스트림 처리
  ["stream-failed", ["ffmpeg", "pipe", "stream", "audio", "codec"]],
  ["voice-permission", ["missing access", "missing permissions", "voice_join", "speak"]],
];

// 이름이 곧 종류인 것. 오류를 만든 곳이 붙인다
const KINDS = new Set(["age-cookies-invalid", "age-restricted", "bot-check", "video-unavailable", "geo-blocked", "rate-limited", "no-youtube-match", "network", "stream-failed", "voice-permission"]);
// 연결이 끊기거나 닿지 않은 것(Node · undici 가 붙이는 이름)
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);
// 디스코드 API 오류 번호. 50001 접근 없음 · 50013 권한 없음
const DISCORD_KINDS: Record<number, string> = { 50001: "voice-permission", 50013: "voice-permission" };

/** 코드를 단 오류. 만든 곳이 무엇이 안 됐는지 안다 */
function codedError(code: string, message: string, options?: { cause?: unknown }) {
  return Object.assign(new Error(message, options), { code });
}

const matches = (msg: string, test: Test): boolean => (typeof test === "function" ? test(msg) : msg.includes(test));

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

function errorKind(error: unknown): string {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
  const coded = kindOfCode(codeOf(error)) ?? kindOfCode(codeOf(cause));
  if (coded) return coded;
  // AbortSignal.timeout 이 끊은 요청. (음성 연결의 기다림이 끝난 것은 AbortError 라 여기 들지 않는다)
  if (error && typeof error === "object" && "name" in error && error.name === "TimeoutError") return "network";
  const msg = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  for (const [kind, tests] of RULES) if (tests.some((test) => matches(msg, test))) return kind;
  return "unknown";
}

export { errorKind, codedError, codeOf, messageOf, RULES };
