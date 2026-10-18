// 저장소를 임시 폴더의 DB 들로 연다. 운영 DB 와 audio_cache 를 건드리지 않는다.
//
//   const store = openTempStore("guild-");
//   after(() => store.close());

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as audioCache from "../../src/store/audio-cache.ts";

import * as stores from "../../src/store/stores.ts";
import { cacheDb } from "../../src/store/cache-db.ts";
import { settingsDb } from "../../src/store/settings-db.ts";
import * as settings from "../../src/store/guild-settings.ts";

function openTempStore(prefix = "store-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  audioCache._setCacheDir(path.join(dir, "audio_cache"));
  stores.open(dir);
  audioCache.initialize();
  return {
    dir,
    /** 캐시 DB(캐시 파일 · 링크 데이터) */
    db: () => cacheDb.get(),
    /** 설정 DB(서버별 설정) */
    settings: () => settingsDb.get(),
    close() {
      audioCache.close();
      stores.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

// 서버 설정을 표에 바로 쓰고 메모리 캐시를 비운다. 준 필드만 쓴다
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

/** 서버 설정 표가 망가진 동안 fn 을 부른다(표를 치워 두었다가 되돌린다). 표를 부르면 진짜 SQLite 오류가 난다 */
async function whenSettingsBroken<T>(fn: () => T | Promise<T>): Promise<T> {
  const db = settingsDb.get();
  db.exec("ALTER TABLE guild_settings RENAME TO guild_settings_off");
  try {
    return await fn();
  } finally {
    db.exec("ALTER TABLE guild_settings_off RENAME TO guild_settings");
  }
}

export { openTempStore, setGuild, whenSettingsBroken };
