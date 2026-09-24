// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 서버 목록. 봇과 함께 있는 서버 중 실제 멤버인 것

import express from "express";
import requireAuth from "../middleware/requireAuth.ts";
import owner from "../owner.ts";
const { isOwner } = owner;
import guildAccess from "../guildAccess.ts";
const { voiceFlags } = guildAccess;

const MANAGE_GUILD = 0x20;

function createGuildListRouter() {
  const router = express.Router();

  // Mutual guilds (user + bot)
  router.get("/", requireAuth, async (req, res) => {
    const client = req.app.locals.discordClient;
    if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다" });

    // 후보는 세션의 서버 목록이지만 표시는 실멤버십으로 필터 (추방된 서버는 목록에서 제외).
    const candidates = (req.session.user.guilds || []).filter((g) => client.guilds.cache.has(g.id));
    const verified = await Promise.all(
      candidates.map(async (g) => {
        if (isOwner(req)) return g; // 봇 운영자는 실멤버십과 무관
        try {
          await client.guilds.cache.get(g.id).members.fetch(req.session.user.id); // 캐시 우선
          return g;
        } catch {
          return null; // 더 이상 멤버 아님 → 목록에서 제외
        }
      }),
    );

    const mutual = verified.filter(Boolean).map((g) => {
      const guild = client.guilds.cache.get(g.id);
      return {
        id: g.id,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=64` : null,
        canManageGuild: (parseInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD, // 그 서버의 "서버 관리" 권한. 봇 운영자(isOwner)와 무관
        hasPlayer: client.players?.has(g.id) || false,
        memberCount: guild.memberCount,
        // 전역 재생 바가 대상 서버를 찾는 기준. 동시 음성 참여는 불가능하므로 참인 서버는 많아야 하나다.
        // 캐시된 음성 상태만 읽으므로 REST 호출이 늘지 않는다.
        listening: voiceFlags(guild, req.session.user.id).sameVoice,
      };
    });

    res.json({ guilds: mutual });
  });

  return router;
}

const exported = { createGuildListRouter };
export default exported;
export { exported as "module.exports" };
