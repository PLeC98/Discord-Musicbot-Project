// 판정: 이 오류는 디스코드가 요청을 거절한 것인가, 어떤 부류인가. 답: Rejection | null.
// 거절은 요청 하나가 실패한 것이고 다시 보내도 같은 답이다. 플레이어 상태가 깨졌다는 뜻이 아니라 서버를 다시 시작해도 낫지 않는다(app/resilience).
// 디스코드 JSON 오류 코드는 숫자다(DiscordAPIError의 code). 우리 오류, Node, 라이브러리의 이름은 글이라 섞이지 않는다

import { chainOf } from "./error-kind.ts";

type Family = "interaction" | "gone" | "permission" | "other";
/** 거절 하나. request: 메서드와 경로(쿼리, 상호작용 토큰은 뺀다), 모르면 null */
type Rejection = { family: Family; level: "warn" | "error"; code: number; meaning: string | null; message: string; request: string | null };

// 코드마다의 부류와 뜻. 상호작용 수명과 사라진 대상은 바깥 상태가 바뀐 것이라 warn, 권한과 그 밖(우리 요청이 틀림)은 error
const KNOWN: Record<number, { family: Family; meaning: string }> = {
  10062: { family: "interaction", meaning: "상호작용에 3초 안에 응답하지 못함(봇이 바빴거나 네트워크가 느렸거나, 같은 토큰으로 다른 봇이 실행 중)" },
  40060: { family: "interaction", meaning: "이미 응답한 상호작용에 다시 응답함(코드가 두 번 응답했거나, 같은 토큰으로 다른 봇이 실행 중)" },
  50027: { family: "interaction", meaning: "상호작용 토큰이 만료됨(15분)" },
  10015: { family: "interaction", meaning: "웹훅이 없음(지워졌거나 봇이 서버를 나갔다 들어옴)" },
  10003: { family: "gone", meaning: "채널이 없음" },
  10004: { family: "gone", meaning: "서버가 없음(봇이 나갔거나 추방됨)" },
  10008: { family: "gone", meaning: "메시지가 없음" },
  50001: { family: "permission", meaning: "접근 권한이 없음(채널이나 서버를 볼 수 없음)" },
  50013: { family: "permission", meaning: "작업 권한이 없음" },
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
    if (!one || typeof one !== "object" || !("code" in one) || typeof one.code !== "number") continue;
    const known = KNOWN[one.code];
    const family = known?.family ?? "other";
    const message = "message" in one && typeof one.message === "string" ? one.message : "";
    return { family, level: LEVEL[family], code: one.code, meaning: known?.meaning ?? null, message, request: requestOf(one) };
  }
  return null;
}

/** 로그 한 줄. guildId: 그 서버(모르면 null), where: 어디서 새어 나왔나 */
function rejectionLine(r: Rejection, guildId: string | null, where: string): string {
  const what = r.meaning ?? "디스코드가 요청을 거절함";
  return `${what} (${r.code}${r.message ? ` ${r.message}` : ""}) | ${r.request ?? "요청 모름"} | 서버 ${guildId ?? "모름"} | ${where}`;
}

export { discordRejection, rejectionLine };
export type { Rejection };
