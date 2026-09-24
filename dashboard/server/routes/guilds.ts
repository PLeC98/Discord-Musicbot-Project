// /api/guilds 아래. 부르는 유스케이스로 라우터 넷을 가른다: 서버 목록 · 실시간 알림 · 서버 설정 · 재생

import express from "express";
import type { PlayerStream } from "../playerStream.ts";
import guildList from "./guildList.ts";
const { createGuildListRouter } = guildList;
import playerEvents from "./playerEvents.ts";
const { createPlayerEventsRouter, nudgeAfterChange } = playerEvents;
import guildSettings from "./guildSettings.ts";
const { createGuildSettingsRouter } = guildSettings;
import player from "./player.ts";
const { createPlayerRouter } = player;

function createGuildsRouter({ stream }: { stream: PlayerStream }) {
  const router = express.Router();
  router.use(nudgeAfterChange(stream), createGuildListRouter(), createPlayerEventsRouter({ stream }), createGuildSettingsRouter(), createPlayerRouter());
  return router;
}

const exported = { createGuildsRouter };
export default exported;
export { exported as "module.exports" };
