"use strict";

// /api/guilds 아래. 부르는 유스케이스로 라우터 넷을 가른다: 서버 목록 · 실시간 알림 · 서버 설정 · 재생

const express = require("express");
const { createGuildListRouter } = require("./guildList");
const { createPlayerEventsRouter, nudgeAfterChange } = require("./playerEvents");
const { createGuildSettingsRouter } = require("./guildSettings");
const { createPlayerRouter } = require("./player");

function createGuildsRouter({ stream }) {
  const router = express.Router();
  router.use(nudgeAfterChange(stream), createGuildListRouter(), createPlayerEventsRouter({ stream }), createGuildSettingsRouter(), createPlayerRouter());
  return router;
}

module.exports = { createGuildsRouter };
