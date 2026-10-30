// 곡을 못 틀었을 때 그 까닭이 어디까지 닿는가. 넘길지 · 셀지 · 그 곡에서 멈출지를 이것으로 정한다(player 의 실패 처리).
//   track       이 곡만 안 된다. 다음 곡은 된다 → 넘기고 세지 않는다
//   environment 봇 · 망 · 음원 서비스가 지금 안 된다. 다음 곡도 같이 안 된다 → 넘기지 않고 그 곡에서 멈춘다(넘기면 멀쩡한 대기열을 태운다)
//   unknown     어느 쪽인지 근거가 없다 → 넘기고 센다(연달아면 멈춘다)
// 판정은 오류 사슬을 가까운 것부터: 만든 곳이 붙인 범위(scope) → HTTP 상태 → 이름 → 연결 이름. 같은 이름(stream-failed 등)이 곡 탓도 환경 탓도 되는 곳은 만든 곳이 scope 를 붙인다.
// 아래 층(yt-dlp · 청크 · 조각 재시도, 클라이언트 바꾸기 등)이 다 해 보고 올라온 실패다. 그래서 환경 탓은 몇 초 안에 풀릴 일이 아니다

import { chainOf, codeOf, isNetworkCode } from "../rules/error-kind.ts";
import { deadSourceCode } from "../sources/dead-source.ts";
import { SsrfError } from "../infra/safe-url.ts";

type FailureScope = "track" | "environment" | "unknown";

// 이 곡의 성질이나 이 곡에만 걸리는 설정. 연령 제한 · 쿠키는 대기열의 다른 곡에 걸리지 않는다
const TRACK = new Set(["unavailable-contents", "sc-preview-only", "geo-blocked", "age-content-off", "age-channel-only", "yt-age-no-cookies", "yt-age-cookies-invalid", "sp-no-youtube-match", "unsupported-link", "shoutcast-v1", "pinned-live", "live-ended"]);
// 다음 곡도 같은 이유로 안 된다
const ENVIRONMENT = new Set(["network-error", "rate-limited", "yt-bot-check", "encoder-unavailable"]);
// 근거가 없다고 아는 이름. 유튜브 클라이언트 탓은 아래 재시도를 다 쓰고 올라온 것이라 다음 곡에도 걸릴 수 있다. 판정은 표에 없는 이름과 같다(모름). 테스트가 재생 쪽 이름이 빠짐없이 어느 표에 있는지 본다
const UNKNOWN = new Set(["stream-failed", "direct-unavailable", "no-audio-only", "client-fault", "stale-media", "skipped-client", "no-formats", "unknown-error"]);

const SCOPES = new Set<unknown>(["track", "environment", "unknown"]);

// 유튜브 · 사운드클라우드 스트림의 HTTP 상태. 같은 CDN 이 다음 곡도 막는다(만료 · 차단 · 요청 제한 · 서버 오류)
function streamStatus(status: number): FailureScope {
  if (status === 404 || status === 410) return "track";
  if (status === 401 || status === 403 || status === 429 || status >= 500) return "environment";
  return "unknown";
}

// 직접 링크는 링크마다 서버가 다르고, 핫링크 차단 · 만료된 서명 주소는 그 링크만 403 이다. 없어졌다(404 · 410)만 곡 탓
const directStatus = (status: number): FailureScope => (status === 404 || status === 410 ? "track" : "unknown");

/** 이 실패가 어디까지 닿는가. direct: 직접 링크 곡이다(HTTP 상태를 링크 하나의 일로 본다) */
function failureScope(error: unknown, { direct = false }: { direct?: boolean } = {}): FailureScope {
  if (deadSourceCode(error)) return "track";
  for (const one of chainOf(error)) {
    if (one instanceof SsrfError) return "track"; // 그 링크가 가리키는 곳 자체가 막혔다
    const tagged = (one as { scope?: unknown }).scope;
    if (SCOPES.has(tagged)) return tagged as FailureScope;
    const status = (one as { status?: unknown }).status;
    if (typeof status === "number") return direct ? directStatus(status) : streamStatus(status);
    const code = codeOf(one);
    if (typeof code !== "string") continue;
    if (TRACK.has(code)) return "track";
    // 직접 링크의 연결 실패는 그 링크의 서버만일 수 있다
    if (code === "network-error" || isNetworkCode(code)) return direct ? "unknown" : "environment";
    if (ENVIRONMENT.has(code)) return "environment";
  }
  // AbortSignal.timeout 이 끊은 요청
  if (chainOf(error).some((one) => (one as { name?: unknown }).name === "TimeoutError")) return direct ? "unknown" : "environment";
  return "unknown";
}

export { failureScope, TRACK, ENVIRONMENT, UNKNOWN };
export type { FailureScope };
