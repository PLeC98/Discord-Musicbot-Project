import type { Request, Response } from "express";
import * as S from "../../../src/ui/strings.ts";
import { signedIn } from "./requireAuth.ts";
import { shadowMember } from "../viewAs.ts";

// Discord 쪽 오류 문자열(❌ 접두)을 대시보드 JSON용으로 정리
const toApiError = S.withoutErrorMark;

// 세션 사용자를 실제 서버 멤버로 해석. 세션에 캐시된 서버 목록 대신 실멤버십 기준.
// 실패 시 res에 응답을 쓰고 null 반환.
async function resolveMember(req: Request<{ guildId: string }>, res: Response) {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) {
    res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });
    return null;
  }

  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) {
    res.status(404).json({ error: "서버를 찾을 수 없습니다." });
    return null;
  }

  let member;
  try {
    // 캐시 우선, 미스 시에만 REST 1회. 권한 수준 오버라이드는 여기서 반영된다.
    member = shadowMember(req, await guild.members.fetch(signedIn(req).id));
  } catch {
    res.status(403).json({ error: "서버 멤버가 아닙니다" });
    return null;
  }
  return { client, guild, member };
}

export { resolveMember, toApiError };
