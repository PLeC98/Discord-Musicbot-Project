"use strict";

const fs = require("fs");
const path = require("path");
const CacheManager = require("./CacheManager");
const config = require("../config");

// 구 node-json-db 시절의 저장 파일 — 발견 시 1회 SQLite로 이관 후 .bak으로 보존
const LEGACY_JSON = path.join(__dirname, "..", "database", "settings.json");

class GuildSettingsManager {
  constructor() {
    this.cache = new Map();
    this._migrateLegacyJson();
  }

  _migrateLegacyJson() {
    try {
      if (!fs.existsSync(LEGACY_JSON)) return;

      const data = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf8"));
      let migrated = 0;
      for (const [guildId, settings] of Object.entries(data?.guilds || {})) {
        if (settings?.botChannel) {
          CacheManager.setBotChannel(guildId, settings.botChannel);
          migrated++;
        }
      }

      // 샤딩 시 다른 프로세스가 먼저 리네임했을 수 있음 — ENOENT는 무시
      try {
        fs.renameSync(LEGACY_JSON, LEGACY_JSON + ".bak");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      console.log(`[GuildSettings] settings.json → SQLite 마이그레이션 완료 (${migrated}건, 원본은 settings.json.bak 보존)`);
    } catch (error) {
      console.error("❌ [GuildSettings] settings.json 마이그레이션 실패:", error.message);
    }
  }

  async setBotChannel(guildId, channelId) {
    try {
      CacheManager.setBotChannel(guildId, channelId);
      this.cache.set(`${guildId}_botChannel`, channelId);
      return true;
    } catch (error) {
      console.error("❌ [GuildSettings] setBotChannel failed:", error);
      return false;
    }
  }

  async getBotChannel(guildId) {
    const key = `${guildId}_botChannel`;
    if (this.cache.has(key)) return this.cache.get(key);
    try {
      const channelId = CacheManager.getBotChannel(guildId);
      this.cache.set(key, channelId);
      return channelId;
    } catch {
      this.cache.set(key, null);
      return null;
    }
  }

  async clearBotChannel(guildId) {
    try {
      CacheManager.clearBotChannel(guildId);
    } catch {}
    this.cache.delete(`${guildId}_botChannel`);
  }

  async setDjRoles(guildId, roleIds) {
    try {
      CacheManager.setDjRoles(guildId, roleIds);
      this.cache.set(`${guildId}_djRoles`, roleIds);
      return true;
    } catch (error) {
      console.error("❌ [GuildSettings] setDjRoles failed:", error);
      return false;
    }
  }

  /** DJ 역할 ID 목록 — 미설정이면 빈 배열 */
  async getDjRoles(guildId) {
    const key = `${guildId}_djRoles`;
    if (this.cache.has(key)) return this.cache.get(key);
    try {
      const roleIds = CacheManager.getDjRoles(guildId);
      this.cache.set(key, roleIds);
      return roleIds;
    } catch {
      this.cache.set(key, []);
      return [];
    }
  }

  async clearDjRoles(guildId) {
    try {
      CacheManager.clearDjRoles(guildId);
    } catch {}
    this.cache.delete(`${guildId}_djRoles`);
  }

  // ── SponsorBlock 서버별 설정 ────────────────────────────────────────────────

  /** 서버별 원본 설정(상속=null) — { enabled: null|bool, categories: null|string[] } */
  async getSponsorBlock(guildId) {
    const key = `${guildId}_sb`;
    if (this.cache.has(key)) return this.cache.get(key);
    let v;
    try {
      v = CacheManager.getGuildSponsorBlock(guildId);
    } catch {
      v = { enabled: null, categories: null };
    }
    this.cache.set(key, v);
    return v;
  }

  /** 부분 갱신 — patch에 준 키만 변경(enabled/categories). null 전달 시 "상속"으로 되돌림. */
  async setSponsorBlock(guildId, patch) {
    const cur = await this.getSponsorBlock(guildId);
    const next = {
      enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
      categories: patch.categories !== undefined ? patch.categories : cur.categories,
    };
    try {
      CacheManager.setGuildSponsorBlock(guildId, next);
      this.cache.set(`${guildId}_sb`, next);
      return true;
    } catch (error) {
      console.error("❌ [GuildSettings] setSponsorBlock failed:", error);
      return false;
    }
  }

  /**
   * 유효 SponsorBlock 설정 — { enabled, categories }.
   * 전역 마스터(config)가 off면 서버 설정과 무관하게 하드 off(상업적 이용 컴플라이언스).
   * 마스터 on이면: enabled = 서버값 ?? true(기본 on), categories = 서버값 ?? 전역 기본.
   */
  resolveSponsorBlock(guildId) {
    const master = config.sponsorblock;
    if (!master.enabled) return { enabled: false, categories: [] };
    let per;
    try {
      per = CacheManager.getGuildSponsorBlock(guildId);
    } catch {
      per = { enabled: null, categories: null };
    }
    return {
      enabled: per.enabled === null ? true : per.enabled,
      categories: per.categories ?? master.categories,
    };
  }
}

module.exports = new GuildSettingsManager();
