"use strict";

const log = require("./logger").child({ category: "guild" });
const CacheManager = require("./CacheManager");
const config = require("../config");

class GuildSettingsManager {
  constructor() {
    this.cache = new Map();
  }

  async setBotChannel(guildId, channelId) {
    try {
      CacheManager.setBotChannel(guildId, channelId);
      this.cache.set(`${guildId}_botChannel`, channelId);
      return true;
    } catch (error) {
      log.error("전용 채널 저장 실패:", error);
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
      log.error("DJ 역할 저장 실패:", error);
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
      log.error("SponsorBlock 설정 저장 실패:", error);
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
