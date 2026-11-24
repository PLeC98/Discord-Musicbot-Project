// 판정: 이 오류는 디스코드가 요청을 거절한 것인가, 어떤 부류인가. 답: Rejection | null.
// 거절은 요청 하나가 실패한 것이고 다시 보내도 똑같이 거절된다. 플레이어 상태가 깨졌다는 뜻이 아니라 서버를 다시 시작해도 낫지 않는다(app/resilience).
// DiscordAPIError는 숫자 code(디스코드 JSON 오류 코드)와 숫자 status(HTTP)를 함께 가진다. 숫자 code만 보면 DOMException(TimeoutError 23 등), 자식 프로세스의 종료 코드가 섞인다

import { chainOf } from "./error-kind.ts";
import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";

type Family = "interaction" | "gone" | "permission" | "other";
/** 거절 정보. request: 메서드와 경로(쿼리, 상호작용 토큰은 뺀다), 모르면 null */
type Rejection = { family: Family; level: "warn" | "error"; code: number; meaning: LogText | null; message: string; request: string | null };

// 코드마다의 부류와 뜻. 상호작용 수명과 사라진 대상은 바깥 상태가 바뀐 것이라 warn, 권한과 그 밖(우리 요청이 틀림)은 error
const KNOWN: Record<number, { family: Family; meaning: LogText }> = {
  10062: { family: "interaction", meaning: L.core.rejectInteractionTimeout() },
  40060: { family: "interaction", meaning: L.core.rejectInteractionTwice() },
  50027: { family: "interaction", meaning: L.core.rejectTokenExpired() },
  10015: { family: "interaction", meaning: L.core.rejectNoWebhook() },
  10003: { family: "gone", meaning: L.core.rejectNoChannel() },
  10004: { family: "gone", meaning: L.core.rejectNoGuild() },
  10008: { family: "gone", meaning: L.core.rejectNoMessage() },
  50001: { family: "permission", meaning: L.core.rejectNoAccess() },
  50013: { family: "permission", meaning: L.core.rejectNoPermission() },
};
const LEVEL: Record<Family, "warn" | "error"> = { interaction: "warn", gone: "warn", permission: "error", other: "error" };

// 거절된 요청의 메서드와 경로. 웹훅, 상호작용 콜백 경로의 토큰은 가린다(로그 가리기는 경로 안의 토큰을 모른다)
function requestOf(one: object): string | null {
  const url = "url" in one && typeof one.url === "string" ? one.url : null;
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0];
  }
  path = path.replace(/^\/api\/v\d+/, "").replace(/\/(webhooks|interactions)\/(\d+)\/[^/]+/, "/$1/$2/[REDACTED]");
  const method = "method" in one && typeof one.method === "string" ? one.method.toUpperCase() : null;
  return method ? `${method} ${path}` : path;
}

/** 디스코드가 요청을 거절한 오류면 그 부류, 아니면 null. 원인 사슬도 본다 */
function discordRejection(error: unknown): Rejection | null {
  for (const one of chainOf(error)) {
    if (!one || typeof one !== "object" || !("code" in one) || typeof one.code !== "number" || !("status" in one) || typeof one.status !== "number") continue;
    const known = KNOWN[one.code];
    const family = known?.family ?? "other";
    const message = "message" in one && typeof one.message === "string" ? one.message : "";
    return { family, level: LEVEL[family], code: one.code, meaning: known?.meaning ?? null, message, request: requestOf(one) };
  }
  return null;
}

/** 로그 한 줄. guildId: 그 서버(모르면 null), where: 어디서 새어 나왔나 */
function rejectionLine(r: Rejection, guildId: string | null, where: LogText): LogText {
  return L.core.rejectionLine({ what: r.meaning ?? L.core.rejectUnknown(), code: r.code, message: r.message, request: r.request, guild: guildId, where });
}

export { discordRejection, rejectionLine };
export type { Rejection };
