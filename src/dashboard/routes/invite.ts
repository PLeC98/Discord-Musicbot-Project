// 봇 초대(/api/invite). 로그인 때 받은 토큰으로 디스코드에서 서버 목록을 받아, 서버 관리 권한이 있고 지금 봇이 없는 서버를 준다

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { sendProblem } from "../problem.ts";
import { tokenStoreOf } from "../session-store.ts";
import { canInvite, managedGuilds } from "../invite.ts";
import { guildIconUrl } from "../images.ts";
import { inviteUrl } from "../../rules/invite-url.ts";
import { messageOf } from "../../rules/error-kind.ts";
import config from "../../config/index.ts";
import { discordHttp, type DiscordHttp } from "../discord-api.ts";
import type { InviteList } from "../contract/invite.ts";

const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status;

/** http: 디스코드를 부르는 HTTP 클라이언트. 생략하면 진짜(fetch) */
function createInviteRouter({ http = discordHttp }: { http?: DiscordHttp } = {}) {
  const router = express.Router();

  // fresh=1: 갱신 버튼. 잠깐 둔 목록을 건너뛰고 디스코드에 다시 묻는다
  router.get("/", requireAuth, async (req, res) => {
    const { client } = req.app.locals.bot;
    if (!client.isReady()) return sendProblem(res, "bot-not-ready");
    const user = signedIn(req);
    if (!canInvite(client, user.id)) return sendProblem(res, "invite-unavailable");

    const relogin: InviteList = { state: "relogin" };
    // 토큰이 없다: 토큰을 두기 전의 세션이거나 SECRETS_KEY 를 바꿨다
    const token = tokenStoreOf(req)?.readDiscordToken(req.sessionID);
    if (!token) return res.json(relogin);

    try {
      const managed = await managedGuilds(req.sessionID, token, { fresh: req.query.fresh === "1", http });
      // 봇이 든 서버는 지금 값으로 뺀다(초대해 봇이 들면 바로 빠진다)
      const guilds = managed.filter((g) => !client.guilds.cache.has(g.id)).map((g) => ({ id: g.id, name: g.name, icon: guildIconUrl(g.id, g.icon), inviteUrl: inviteUrl(config.discord.clientId, g.id) }));
      res.json({ state: "ready", guilds } satisfies InviteList);
    } catch (error) {
      const status = statusOf(error);
      // 토큰이 만료됐거나 사용자가 디스코드에서 승인을 거뒀다
      if (status === 401) return res.json(relogin);
      if (status === 429) return sendProblem(res, "rate-limited");
      log.warn(`초대 화면의 서버 목록을 디스코드에서 받지 못했습니다: ${status ? `상태 코드 ${status}` : messageOf(error)}`);
      sendProblem(res, "unknown-error");
    }
  });

  return router;
}

export { createInviteRouter };
