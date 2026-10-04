// 서버 목록. 봇이 든 서버 중 지금 멤버인 것(운영자는 전부)

import express from "express";
import { PermissionFlagsBits } from "discord.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { requireAuth, signedIn } from "../middleware/require-auth.ts";
import { isOwner } from "../owner.ts";
import { voiceFlags } from "../guild-access.ts";
import { sendProblem } from "../problem.ts";
import { soundAttached } from "../../ui/player-status.ts";
import type { Player } from "../../player/player.ts";

/** 서버 목록의 상태: 봇이 음성 채널 밖 = idle(유휴 상태), 곡을 트는 중 = playing, 일시정지 = paused, 음성 채널에 있지만 곡이 없다 = waiting(대기 중) */
type ListState = "idle" | "playing" | "paused" | "waiting";

function listState(botInVoice: boolean, player: Player | undefined): ListState {
  if (!botInVoice) return "idle";
  // 곡을 여는 중이면 아직 곡이 없다(유령 재생을 보이지 않는 대시보드 규칙과 같다)
  if (!player || !soundAttached(player)) return "waiting";
  const status = player.audioPlayer?.state?.status;
  return status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused ? "paused" : "playing";
}

function createGuildListRouter() {
  const router = express.Router();

  // 봇이 든 서버 중 지금 멤버인 곳(운영자는 전부). 로그인 때 받은 서버 목록에 기대지 않아 그 뒤 들어간 서버도 보이고 나간 서버는 빠진다
  router.get("/", requireAuth, async (req, res) => {
    const { client, players } = req.app.locals.bot;
    if (!client.isReady()) return sendProblem(res, "bot-not-ready");

    const user = signedIn(req);
    const owner = isOwner(req);
    const rows = await Promise.all(
      [...client.guilds.cache.values()].map(async (guild) => {
        const member = await guild.members.fetch(user.id).catch(() => null); // 캐시 우선
        if (!member && !owner) return null;
        return {
          id: guild.id,
          name: guild.name,
          icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp?size=64` : null,
          // 그 서버의 "서버 관리" 권한. 지금 멤버 권한으로 본다. 봇 운영자(isOwner)와 무관
          canManageGuild: member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false,
          hasPlayer: players.has(guild.id),
          state: listState(voiceFlags(guild, user.id).botInVoice, players.get(guild.id)),
          memberCount: guild.memberCount,
          // 전역 재생 바가 대상 서버를 찾는 기준. 동시 음성 참여는 불가능하므로 참인 서버는 많아야 하나다.
          // 캐시된 음성 상태만 읽으므로 REST 호출이 늘지 않는다.
          listening: voiceFlags(guild, user.id).sameVoice,
        };
      }),
    );
    // 디스코드가 로그인 때 주던 차례(서버 ID 차례)
    const guilds = rows.filter((row) => row !== null).sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    res.json({ guilds });
  });

  return router;
}

export { createGuildListRouter };
