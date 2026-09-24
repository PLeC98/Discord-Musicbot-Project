// 저장소를 임시 폴더의 DB 로 연다. 운영 DB 와 audio_cache 를 건드리지 않는다.
//
//   const store = openTempStore("guild-");
//   after(() => store.close());

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as audioCache from "../../src/store/audioCache.ts";

import * as storeDb from "../../src/store/db.ts";
import * as settings from "../../src/store/guildSettings.ts";

function openTempStore(prefix = "store-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  audioCache._setCacheDir(path.join(dir, "audio_cache"));
  audioCache.initialize(path.join(dir, "cache.db"));
  return {
    dir,
    db: () => storeDb.get(),
    close() {
      audioCache.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

// 서버 설정을 표에 바로 쓰고 메모리 캐시를 비운다. 준 칸만 쓴다
type GuildPatch = {
  djRoles?: Parameters<typeof settings.table.setDjRoles>[1];
  botChannel?: string | null;
  playlistAddMax?: Parameters<typeof settings.table.setPlaylistAddMax>[1];
  sponsorBlock?: Parameters<typeof settings.table.setGuildSponsorBlock>[1];
};

function setGuild(guildId: string, { djRoles, botChannel, playlistAddMax, sponsorBlock }: GuildPatch = {}) {
  if (djRoles !== undefined) settings.table.setDjRoles(guildId, djRoles);
  if (botChannel !== undefined) {
    if (botChannel === null) settings.table.clearBotChannel(guildId);
    else settings.table.setBotChannel(guildId, botChannel);
  }
  if (playlistAddMax !== undefined) settings.table.setPlaylistAddMax(guildId, playlistAddMax);
  if (sponsorBlock !== undefined) settings.table.setGuildSponsorBlock(guildId, sponsorBlock);
  settings._reset();
}

export { openTempStore, setGuild };
