// 재생 상태가 바뀌었다는 알림(SSE). 받은 화면이 GET 으로 다시 읽는다

import express, { type NextFunction, type Request, type Response } from "express";
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import type { PlayerStream } from "../player-stream.ts";
import { sendProblem } from "../problem.ts";
import { memberOf, seesGuild } from "../guild-access.ts";
import { memberGuildIds } from "../user-guilds.ts";
import type { DiscordHttp } from "../discord-api.ts";
import * as sessionRequests from "../session-requests.ts";

// 대시보드발 상태 변경(비-GET 성공) → 그 서버를 볼 수 있는 SSE 구독자에게 넛지.
// req.params 는 라우터를 빠져나오면 되돌아가므로, 요청 주소(originalUrl)에서 서버 ID 를 미리 추출해 finish 에서 쓴다.
// (디스코드 쪽, 내부 변화는 player/events 의 touched 가 알린다)
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

/** http: 디스코드를 부르는 HTTP 클라이언트(사용자의 서버 목록). 생략하면 진짜 */
function createPlayerEventsRouter({ stream, http }: { stream: PlayerStream; http?: DiscordHttp }) {
  const router = express.Router();

  // SSE. 화면의 탭 하나가 여는 연결. 사용자 단위 멀티플렉스(볼 수 있는 서버 전체를 한 연결로).
  // 보기 권한 확인은 보낼 때 멤버 캐시로 한다(동기여야 한다. 권한, 서버 목록과 같은 기댐). 그래서 열 때 사용자가 든 서버(사용자의 서버 목록)만
  // 한 번 가져와 캐시를 채운다(캐시 우선, 없으면 REST). 목록을 받지 못하면 이미 확인한 서버만. 운영자도 참가한 서버만
  router.get("/events", requireAuth, async (req, res) => {
    const { client } = req.app.locals.bot;
    if (!client.isReady()) return sendProblem(res, "bot-not-ready");

    const user = signedIn(req);
    // 슬롯은 멤버 확인(REST) 전에 확보하고 조회가 끝날 때까지 유지한다. 이 경로는 요청 한도 밖이라 열고 끊기를 되풀이해도 끝나지 않은 조회가 상한을 넘지 않게 한다
    const slot = res.closed ? null : stream.reserve(user.id);
    if (!slot) return res.closed ? undefined : sendProblem(res, "too-many-streams");
    let handed = false;
    try {
      const { ids } = await memberGuildIds(req, { http });
      const all = [...client.guilds.cache.values()];
      const checked = ids ? await Promise.all(all.filter((guild) => ids.has(guild.id)).map(async (guild) => ((await memberOf(guild, user.id)) ? guild.id : null))) : all.filter((guild) => seesGuild(guild, user.id)).map((guild) => guild.id);
      const canSee = (guildId: string) => seesGuild(client.guilds.cache.get(guildId), user.id);
      // 기다리는 사이 세션이 끝났으면 열지 않는다(끝 알림은 연 스트림만 받는다). 확인, 열기, 묶기 사이에는 기다리지 않는다
      if (!sessionRequests.admit(req)) return sendProblem(res, "login-required");
      if (!stream.open(res, slot, canSee, new Set(checked.filter((id) => id !== null)))) return;
      handed = true;
      sessionRequests.track(req, res, "재생 상태", () => stream.drop(res));
    } finally {
      if (!handed) slot.release();
    }
  });

  return router;
}

/**
 * 봇이 새 서버에 들었다. 그때 캐시에는 봇과 음성 채널에 있는 사람만 들어오므로(GUILD_PRESENCES 인텐트가 없다)
 * 연결을 연 사람들을 그 서버에서 한 번씩 가져와 캐시를 채우고, 화면이 다시 읽게 알린다
 */
async function botJoinedGuild(stream: PlayerStream, guild: Parameters<typeof memberOf>[0]) {
  await Promise.all([...stream.listUsers()].map(async (id) => (await memberOf(guild, id)) && stream.watch(id, guild.id)));
  stream.notify(guild.id);
}

/**
 * 게이트웨이에 재연결해 사용 불가(unavailable) 서버가 다시 사용 가능해졌다. discord.js 가 그 서버의 멤버 캐시를 다시 받는데 봇과 음성 채널 사람만 들어,
 * 연결을 연 사람이 빠져 소식이 끊긴다. 그 서버를 멤버로 확인했던 연결의 사람만 다시 가져온다(연결 수 × 서버 수만큼 조회하지 않는다).
 * 그사이 나간 사람은 멤버가 아니라는 답을 받아 계속 빠진다
 */
async function guildBack(stream: PlayerStream, guild: Parameters<typeof memberOf>[0]) {
  await Promise.all([...stream.watching(guild.id)].map((id) => memberOf(guild, id)));
  stream.notify(guild.id);
}

/** 봇이 서버에서 나갔다. 그 서버의 멤버였던 사람(멤버 캐시는 나간 서버 객체에 남아 있다) 중 연결을 연 사람에게 알린다 */
function botLeftGuild(stream: PlayerStream, guild: { id: string; members: { cache: { has(id: string): boolean } } }) {
  stream.notifyLeft(guild.id, new Set([...stream.listUsers()].filter((id) => guild.members.cache.has(id))));
}

export { createPlayerEventsRouter, nudgeAfterChange, botJoinedGuild, guildBack, botLeftGuild };
