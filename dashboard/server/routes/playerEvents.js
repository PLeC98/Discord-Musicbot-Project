// 재생 상태가 바뀌었다는 알림(SSE). 받은 화면이 GET 으로 다시 읽는다

import express from "express";
import requireAuth from "../middleware/requireAuth.js";
import owner from "../owner.js";
const { isOwner } = owner;
import guildAccess from "../guildAccess.js";
const { getPlayer } = guildAccess;

// 대시보드발 상태 변경(비-GET 성공) → 해당 서버 SSE 구독자에게 넛지.
// req.params는 스택이 풀리면 복원되므로, 요청 시작 시점의 라우터-상대 URL 첫 세그먼트(=guildId)를
// 클로저로 잡아 finish에서 사용. (디스코드 쪽 · 내부 변화는 player/events 의 touched 가 알린다)
function nudgeAfterChange(stream) {
  return (req, res, next) => {
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

function createPlayerEventsRouter({ stream }) {
  const router = express.Router();

  // SSE. 서버 목록의 재생 상태 실시간 갱신. 사용자 단위 멀티플렉스(상호+멤버 서버 전체를 한 연결로).
  router.get("/events", requireAuth, async (req, res) => {
    const client = req.app.locals.discordClient;
    if (!client?.isReady()) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다" });

    // 구독할 서버 집합 = 상호 서버 중 실멤버십 확인된 것
    const candidates = (req.session.user.guilds || []).filter((g) => client.guilds.cache.has(g.id));
    const guildIds = new Set();
    await Promise.all(
      candidates.map(async (g) => {
        if (isOwner(req)) {
          guildIds.add(g.id);
          return;
        }
        try {
          await client.guilds.cache.get(g.id).members.fetch(req.session.user.id);
          guildIds.add(g.id);
        } catch {
          /* 멤버 아님 → 구독 안 함 */
        }
      }),
    );

    stream.addListClient(res, guildIds, req.session.user.id);
  });

  // SSE. 플레이어 상태 변화 넛지 (하이브리드: 넛지 받으면 클라이언트가 GET /player 재호출)
  router.get("/:guildId/player/events", requireAuth, async (req, res) => {
    const ctx = await getPlayer(req, res, req.params.guildId); // 비멤버 403 / 봇 미참여 404
    if (!ctx) return;
    stream.addClient(req.params.guildId, res, req.session.user.id);
  });

  return router;
}

const exported = { createPlayerEventsRouter, nudgeAfterChange };
export default exported;
export { exported as "module.exports" };
