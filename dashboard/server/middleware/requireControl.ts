import type { Request, Response } from "express";
import { signedIn } from "./requireAuth.ts";
import { shadowMember } from "../viewAs.ts";
import { sendProblem } from "../problem.ts";

// 세션 사용자를 실제 서버 멤버로 해석. 세션에 캐시된 서버 목록 대신 실멤버십 기준.
// 실패 시 res에 응답을 쓰고 null 반환.
async function resolveMember(req: Request<{ guildId: string }>, res: Response) {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) {
    sendProblem(res, "bot-not-ready");
    return null;
  }

  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) {
    sendProblem(res, "guild-not-found");
    return null;
  }

  let member;
  try {
    // 캐시 우선, 미스 시에만 REST 1회. 권한 수준 오버라이드는 여기서 반영된다.
    member = shadowMember(req, await guild.members.fetch(signedIn(req).id));
  } catch {
    sendProblem(res, "not-guild-member");
    return null;
  }
  return { client, guild, member };
}

export { resolveMember };
