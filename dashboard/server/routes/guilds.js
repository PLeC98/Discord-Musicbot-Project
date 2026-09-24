// /api/guilds 아래. 부르는 유스케이스로 라우터 넷을 가른다: 서버 목록 · 실시간 알림 · 서버 설정 · 재생

import express from "express";
import guildList from "./guildList.js";
const { createGuildListRouter } = guildList;
import playerEvents from "./playerEvents.js";
const { createPlayerEventsRouter, nudgeAfterChange } = playerEvents;
import guildSettings from "./guildSettings.js";
const { createGuildSettingsRouter } = guildSettings;
import player from "./player.js";
const { createPlayerRouter } = player;

function createGuildsRouter({ stream }) {
  const router = express.Router();
  router.use(nudgeAfterChange(stream), createGuildListRouter(), createPlayerEventsRouter({ stream }), createGuildSettingsRouter(), createPlayerRouter());
  return router;
}

const exported = { createGuildsRouter };
export default exported;
export { exported as "module.exports" };
