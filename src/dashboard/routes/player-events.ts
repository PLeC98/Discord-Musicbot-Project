// 재생 상태가 바뀌었다는 알림(SSE). 받은 화면이 GET 으로 다시 읽는다

import express, { type NextFunction, type Request, type Response } from "express";
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import type { PlayerStream } from "../player-stream.ts";
import { sendProblem } from "../problem.ts";

// 대시보드발 상태 변경(비-GET 성공) → 그 서버를 볼 수 있는 SSE 구독자에게 넛지.
// req.params 는 라우터를 빠져나오면 되돌아가므로, 요청 주소(originalUrl)에서 서버 ID 를 미리 추출해 finish 에서 쓴다.
// (디스코드 쪽 · 내부 변화는 player/events 의 touched 가 알린다)
function nudgeAfterChange(stream: PlayerStream) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") {
      const m = req.originalUrl.match(/\/guilds\/([^/?]+)/);
      const guildId = m && m[1];
      if (guildId) {
        res.on("finish", () => {
          if (res.statusCode < 400) stream.notify(guildId);
        });
      }
    }
    next();
  };
}

function createPlayerEventsRouter({ stream }: { stream: PlayerStream }) {
  const router = express.Router();

  // SSE. 화면의 탭 하나가 여는 연결. 사용자 단위 멀티플렉스(볼 수 있는 서버 전체를 한 연결로).
  // 볼 수 있는가는 보낼 때 멤버 캐시로 본다(동기여야 한다. 권한 · 서버 목록과 같은 기댐). 그래서 열 때 봇이 든 서버마다
  // 그 사람을 한 번 가져와 캐시를 채운다(캐시 우선, 없으면 REST). 운영자도 참가한 서버만
  router.get("/events", requireAuth, async (req, res) => {
    const { client } = req.app.locals.bot;
    if (!client.isReady()) return sendProblem(res, "bot-not-ready");

    const user = signedIn(req);
    await Promise.all([...client.guilds.cache.values()].map((guild) => guild.members.fetch(user.id).catch(() => null)));
    const canSee = (guildId: string) => Boolean(client.guilds.cache.get(guildId)?.members.cache.has(user.id));
    stream.addClient(res, canSee, user.id);
  });

  return router;
}

/**
 * 봇이 새 서버에 들었다. 그때 캐시에는 봇과 음성 채널에 있는 사람만 들어오므로(GUILD_PRESENCES 인텐트가 없다)
 * 연결을 연 사람들을 그 서버에서 한 번씩 가져와 캐시를 채우고, 화면이 다시 읽게 알린다
 */
async function botJoinedGuild(stream: PlayerStream, guild: { id: string; members: { fetch(id: string): Promise<unknown> } }) {
  await Promise.all([...stream.listUsers()].map((id) => guild.members.fetch(id).catch(() => null)));
  stream.notify(guild.id);
}

export { createPlayerEventsRouter, nudgeAfterChange, botJoinedGuild };
