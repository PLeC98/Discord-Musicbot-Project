// /api/guilds 아래. 부르는 유스케이스로 라우터 넷을 가른다: 서버 목록 · 실시간 알림 · 서버 설정 · 재생

import express from "express";
import type { PlayerStream } from "../playerStream.ts";
import { createGuildListRouter } from "./guildList.ts";
import { createPlayerEventsRouter, nudgeAfterChange } from "./playerEvents.ts";
import { createGuildSettingsRouter } from "./guildSettings.ts";
import { createPlayerRouter } from "./player.ts";

function createGuildsRouter({ stream }: { stream: PlayerStream }) {
  const router = express.Router();
  router.use(nudgeAfterChange(stream), createGuildListRouter(), createPlayerEventsRouter({ stream }), createGuildSettingsRouter(), createPlayerRouter());
  return router;
}

export { createGuildsRouter };
