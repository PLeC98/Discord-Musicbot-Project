"use strict";

// 옮기는 중의 껍데기. 오디오 캐시 · 링크 장부 · 바깥 서비스 캐시는 각자의 파일로 갔고 서버 설정 SQL 만 남았다.
// 옮겨 간 것은 그쪽으로 넘긴다. 부르는 곳을 옮기면 없어진다.

const db = require("./db");
const audioCache = require("./audioCache");
const trackLookup = require("./trackLookup");
const externalCaches = require("./externalCaches");

class CacheManager {
  // 서버 설정

  getBotChannel(guildId) {
    const row = this.db.prepare("SELECT bot_channel_id FROM guild_settings WHERE guild_id = ?").get(guildId);
    return row?.bot_channel_id ?? null;
  }

  setBotChannel(guildId, channelId) {
    this.db
      .prepare(
        `
            INSERT INTO guild_settings (guild_id, bot_channel_id, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                bot_channel_id = excluded.bot_channel_id,
                updated_at     = excluded.updated_at
        `,
      )
      .run(guildId, channelId, Date.now());
  }

  clearBotChannel(guildId) {
    // 행에는 다른 설정(dj_role_ids)도 담겨 있으므로 행 삭제가 아닌 컬럼 초기화
    this.db.prepare("UPDATE guild_settings SET bot_channel_id = NULL, updated_at = ? WHERE guild_id = ?").run(Date.now(), guildId);
  }

  /** DJ 역할 ID 목록. 미설정이면 빈 배열 */
  getDjRoles(guildId) {
    const row = this.db.prepare("SELECT dj_role_ids FROM guild_settings WHERE guild_id = ?").get(guildId);
    if (!row?.dj_role_ids) return [];
    try {
      const parsed = JSON.parse(row.dj_role_ids);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  setDjRoles(guildId, roleIds) {
    const value = roleIds.length ? JSON.stringify(roleIds) : null; // 빈 배열 = 미설정과 동일
    this.db
      .prepare(
        `
            INSERT INTO guild_settings (guild_id, dj_role_ids, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                dj_role_ids = excluded.dj_role_ids,
                updated_at  = excluded.updated_at
        `,
      )
      .run(guildId, value, Date.now());
  }

  clearDjRoles(guildId) {
    this.db.prepare("UPDATE guild_settings SET dj_role_ids = NULL, updated_at = ? WHERE guild_id = ?").run(Date.now(), guildId);
  }

  /** 서버별 SponsorBlock 설정. { enabled: null|bool, categories: null|string[] } (null=전역 상속) */
  getGuildSponsorBlock(guildId) {
    const row = this.db.prepare("SELECT sponsorblock_enabled, sponsorblock_categories FROM guild_settings WHERE guild_id = ?").get(guildId);
    if (!row) return { enabled: null, categories: null };
    let categories = null;
    if (row.sponsorblock_categories) {
      try {
        const p = JSON.parse(row.sponsorblock_categories);
        if (Array.isArray(p)) categories = p;
      } catch {
        /* 손상 값은 상속 취급 */
      }
    }
    const enabled = row.sponsorblock_enabled === null || row.sponsorblock_enabled === undefined ? null : !!row.sponsorblock_enabled;
    return { enabled, categories };
  }

  /** 서버별 SponsorBlock 설정 저장. enabled/categories 각각 null이면 "상속"으로 기록. */
  setGuildSponsorBlock(guildId, { enabled, categories }) {
    const encEnabled = enabled === null || enabled === undefined ? null : enabled ? 1 : 0;
    const encCats = Array.isArray(categories) ? JSON.stringify(categories) : null;
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, sponsorblock_enabled, sponsorblock_categories, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             sponsorblock_enabled    = excluded.sponsorblock_enabled,
             sponsorblock_categories = excluded.sponsorblock_categories,
             updated_at              = excluded.updated_at`,
      )
      .run(guildId, encEnabled, encCats, Date.now());
  }

  /** 재생목록을 넣을 때 한 번에 들어가는 곡 수. 미설정이면 null */
  getPlaylistAddMax(guildId) {
    const row = this.db.prepare("SELECT playlist_add_max FROM guild_settings WHERE guild_id = ?").get(guildId);
    return row?.playlist_add_max ?? null;
  }

  /** null이면 기본값으로 되돌린다 */
  setPlaylistAddMax(guildId, count) {
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, playlist_add_max, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             playlist_add_max = excluded.playlist_add_max,
             updated_at       = excluded.updated_at`,
      )
      .run(guildId, count ?? null, Date.now());
  }

  /** 이 서버의 현재 재생 패널 자리. 없으면 null */
  getPanelRecord(guildId) {
    const row = this.db.prepare("SELECT now_playing_channel_id AS channelId, now_playing_message_id AS messageId FROM guild_settings WHERE guild_id = ?").get(guildId);
    return row?.messageId ? { channelId: row.channelId, messageId: row.messageId } : null;
  }

  /** messageId가 null이면 비운다 */
  setPanelRecord(guildId, channelId, messageId) {
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, now_playing_channel_id, now_playing_message_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             now_playing_channel_id = excluded.now_playing_channel_id,
             now_playing_message_id = excluded.now_playing_message_id,
             updated_at             = excluded.updated_at`,
      )
      .run(guildId, messageId ? channelId : null, messageId ?? null, Date.now());
  }
}

module.exports = new CacheManager();
module.exports.SCHEMA_VERSION = db.SCHEMA_VERSION;

const MOVED = [
  [
    audioCache,
    [
      "_protectedKeys",
      "_protectedFiles",
      "_queuedKeys",
      "_evictInterval",
      "_sessions",
      "_cacheDir",
      "initialize",
      "db",
      "_initialized",
      "md5",
      "getFilePath",
      "protect",
      "unprotect",
      "protectFile",
      "unprotectFile",
      "setQueuedKeys",
      "_liveKeys",
      "lookupByAudioKey",
      "recordDownloadStart",
      "recordDownloadComplete",
      "recordError",
      "recordPlayback",
      "_verificationPolicy",
      "sessions",
      "getProtectedCacheFiles",
      "onStartup",
      "resetCache",
      "_cleanOrphanFiles",
      "_diskFree",
      "_cacheSize",
      "_cacheCount",
      "evictIfNeeded",
      "evict",
      "_startPeriodicEviction",
      "getCacheStats",
      "close",
    ],
  ],
  [trackLookup, ["_normalizeSourceUrl", "resolveFromCache", "recordTrackLookup", "getVerifiedTitle", "getResolvedKey", "removeResolution"]],
  [externalCaches, ["getSponsorSegments", "setSponsorSegments", "markAgeRestricted", "isAgeRestricted", "getSpotifyAnonState", "setSpotifyAnonState"]],
];
for (const [target, moved] of MOVED) {
  for (const name of moved) {
    Object.defineProperty(module.exports, name, {
      get: () => (typeof target[name] === "function" ? target[name].bind(target) : target[name]),
      set: (value) => {
        target[name] = value;
      },
      enumerable: true,
    });
  }
}
