// /api/guilds 아래. 부르는 유스케이스로 라우터 넷으로 나눈다: 서버 목록 · 실시간 알림 · 서버 설정 · 재생

import express from "express";
import { inGuild } from "../../infra/guild-context.ts";
import type { PlayerStream } from "../player-stream.ts";
import { createGuildListRouter } from "./guild-list.ts";
import { createPlayerEventsRouter, nudgeAfterChange } from "./player-events.ts";
import { createGuildSettingsRouter } from "./guild-settings.ts";
import { createPlayerRouter } from "./player.ts";

function createGuildsRouter({ stream }: { stream: PlayerStream }) {
  const router = express.Router();
  // 서버 하나의 경로는 그 서버의 문맥에서 돈다(실행한 프로세스 · 새어 나온 오류가 그 서버로 간다)
  router.use("/:guildId", (req, _res, next) => inGuild(req.params.guildId, next));
  router.use(nudgeAfterChange(stream), createGuildListRouter(), createPlayerEventsRouter({ stream }), createGuildSettingsRouter(), createPlayerRouter());
  return router;
}

export { createGuildsRouter };
