// 서버 목록. 봇이 든 서버 중 지금 멤버인 것(운영자도 같다)

import express from "express";
import { trackArtUrl } from "../player-view.ts";
import { isServerManager } from "../../usecases/permissions.ts";
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { memberOf, seesGuild, voiceFlags } from "../guild-access.ts";
import { memberGuildIds } from "../user-guilds.ts";
import type { DiscordHttp } from "../discord-api.ts";
import { sendProblem } from "../problem.ts";
import { playState, soundAttached } from "../../ui/player-status.ts";
import type { Player } from "../../player/player.ts";
import type { GuildList, GuildRow, ListState } from "../contract/guilds.ts";
import { guildIconUrl } from "../images.ts";

function listState(botInVoice: boolean, player: Player | undefined): ListState {
  if (!botInVoice) return "idle";
  // 곡을 여는 중이면 아직 곡이 없다(유령 재생을 보이지 않는 대시보드 규칙과 같다)
  const state = player ? playState(player) : "idle";
  return state === "idle" ? "waiting" : state;
}

/** http: 디스코드를 부르는 HTTP 클라이언트(사용자의 서버 목록). 생략하면 진짜 */
function createGuildListRouter({ http }: { http?: DiscordHttp } = {}) {
  const router = express.Router();

  // 봇이 든 서버 중 지금 멤버인 곳. 사용자의 서버 목록(세션마다 30초 캐시한다)으로 고르고 멤버인지는 memberOf 로 본다. 나간 서버는 바로 빠지고, 막 든 서버는 목록을 다시 받을 때 보인다
  router.get("/", requireAuth, async (req, res) => {
    const { client, players } = req.app.locals.bot;
    if (!client.isReady()) return sendProblem(res, "bot-not-ready");

    const user = signedIn(req);
    // 사용자가 든 서버만 멤버 판정을 한다(봇이 든 서버마다 조회하지 않는다). 목록을 받지 못하면 이미 확인한 서버(멤버 캐시)만
    const { ids, relogin } = await memberGuildIds(req, { http });
    const candidates = [...client.guilds.cache.values()].filter((guild) => (ids ? ids.has(guild.id) : seesGuild(guild, user.id)));
    const rows = await Promise.all(
      candidates.map(async (guild): Promise<GuildRow | null> => {
        const member = await memberOf(guild, user.id);
        if (!member) return null;
        const player = players.get(guild.id);
        // 지금 곡(서버 카드가 그린다). 소리가 붙기 전에는 곡이 없다(재생 화면과 같은 규칙)
        const track = player && soundAttached(player) ? player.currentTrack : null;
        return {
          id: guild.id,
          name: guild.name,
          icon: guildIconUrl(guild.id, guild.icon),
          // 그 서버의 "서버 관리" 권한. 지금 멤버 권한으로 본다. 봇 운영자(isOwner)와 무관
          canManageGuild: isServerManager(member),
          hasPlayer: players.has(guild.id),
          state: listState(voiceFlags(guild, user.id).botInVoice, player),
          memberCount: guild.memberCount,
          // 전역 재생 바가 대상 서버를 찾는 기준. 동시 음성 참여는 불가능하므로 참인 서버는 많아야 하나다.
          // 캐시된 음성 상태만 읽으므로 REST 호출이 늘지 않는다.
          listening: voiceFlags(guild, user.id).sameVoice,
          nowPlaying: track ? { title: track.title ?? null, artist: track.artist ?? null, thumbnail: trackArtUrl(guild.id, track) } : null,
        };
      }),
    );
    // 디스코드가 로그인 때 주던 순서(서버 ID 순서)
    const guilds = rows.filter((row) => row !== null).sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    res.json({ guilds, ...(relogin ? { relogin: true as const } : {}) } satisfies GuildList);
  });

  return router;
}

export { createGuildListRouter };
