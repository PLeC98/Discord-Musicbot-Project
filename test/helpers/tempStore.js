"use strict";

// 저장소를 임시 폴더의 DB 로 연다. 운영 DB 와 audio_cache 를 건드리지 않는다.
//
//   const store = openTempStore("guild-");
//   after(() => store.close());

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const audioCache = require("../../src/store/audioCache");

function openTempStore(prefix = "store-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  audioCache._cacheDir = path.join(dir, "audio_cache");
  audioCache.initialize(path.join(dir, "cache.db"));
  return {
    dir,
    db: () => audioCache.db,
    close() {
      audioCache.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

// 서버 설정을 표에 바로 쓰고 메모리 캐시를 비운다. 준 칸만 쓴다
function setGuild(guildId, { djRoles, botChannel, playlistAddMax, sponsorBlock } = {}) {
  const settings = require("../../src/store/guildSettings");
  if (djRoles !== undefined) settings.table.setDjRoles(guildId, djRoles);
  if (botChannel !== undefined) {
    if (botChannel === null) settings.table.clearBotChannel(guildId);
    else settings.table.setBotChannel(guildId, botChannel);
  }
  if (playlistAddMax !== undefined) settings.table.setPlaylistAddMax(guildId, playlistAddMax);
  if (sponsorBlock !== undefined) settings.table.setGuildSponsorBlock(guildId, sponsorBlock);
  settings.cache.clear();
}

module.exports = { openTempStore, setGuild };
