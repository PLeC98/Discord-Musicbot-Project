"use strict";

const log = require("./logger").child({ category: "guild" });
const CacheManager = require("./CacheManager");
const config = require("../config");

// 재생목록 한 번에 넣는 곡 수의 위쪽 끝. 대기열 상한이 더 작으면 그쪽을 따른다
const PLAYLIST_ADD_CEILING = 1000;

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

  /** DJ 역할 ID 목록. 미설정이면 빈 배열 */
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

  // ── 현재 재생 패널 자리. 사용자 설정이 아니라 옛 패널을 치우는 기준 ─────────

  /** { channelId, messageId } 또는 null */
  async getPanel(guildId) {
    const key = `${guildId}_panel`;
    if (this.cache.has(key)) return this.cache.get(key);
    let record = null;
    try {
      record = CacheManager.getPanelRecord(guildId);
    } catch {
      /* 읽지 못하면 옛 패널을 못 치울 뿐이다 */
    }
    this.cache.set(key, record);
    return record;
  }

  /** messageId가 null이면 비운다 */
  async setPanel(guildId, channelId, messageId) {
    try {
      CacheManager.setPanelRecord(guildId, channelId, messageId);
      this.cache.set(`${guildId}_panel`, messageId ? { channelId, messageId } : null);
    } catch (error) {
      log.error("현재 재생 패널 자리 저장 실패:", error);
    }
  }

  // ── 재생목록 한 번에 넣는 곡 수 ─────────────────────────────────────────────
  // 첫 묶음과 "더 넣기" 선택지 단위를 정한다. 더 넣기 자체는 대기열 상한만 본다.

  /** 설정할 수 있는 범위와 기본값 */
  playlistAddLimits() {
    const queueMax = config.bot.maxQueueSize;
    return { min: 1, max: queueMax > 0 ? Math.min(PLAYLIST_ADD_CEILING, queueMax) : PLAYLIST_ADD_CEILING, default: config.bot.playlistAddDefault };
  }

  /** 서버가 정한 값. 미설정이면 null */
  async getPlaylistAddMax(guildId) {
    const key = `${guildId}_playlistAdd`;
    if (this.cache.has(key)) return this.cache.get(key);
    let value = null;
    try {
      value = CacheManager.getPlaylistAddMax(guildId);
    } catch {
      /* 읽지 못하면 기본값 */
    }
    this.cache.set(key, value);
    return value;
  }

  /** null이면 기본값으로 되돌린다. 범위 검증은 호출자 몫(명령·대시보드가 사용자에게 알린다). */
  async setPlaylistAddMax(guildId, count) {
    try {
      CacheManager.setPlaylistAddMax(guildId, count);
      this.cache.set(`${guildId}_playlistAdd`, count ?? null);
      return true;
    } catch (error) {
      log.error("재생목록 한 번에 넣는 곡 수 저장 실패:", error);
      return false;
    }
  }

  /**
   * 실제로 쓸 값. 읽을 때마다 범위로 자른다. 서버가 200을 정한 뒤 운영자가 대기열 상한을 줄일 수 있어서다.
   * DB가 열린 뒤에만 읽는다. 열지 않은 채 부르는 테스트가 운영 DB를 건드리지 않게.
   */
  resolvePlaylistAddMax(guildId) {
    const { min, max, default: fallback } = this.playlistAddLimits();
    const key = `${guildId}_playlistAdd`;
    let stored = this.cache.get(key);
    if (stored === undefined && CacheManager._initialized) {
      try {
        stored = CacheManager.getPlaylistAddMax(guildId);
        this.cache.set(key, stored);
      } catch {
        stored = null;
      }
    }
    return Math.max(min, Math.min(max, stored ?? fallback));
  }

  // ── SponsorBlock 서버별 설정 ────────────────────────────────────────────────

  /** 서버별 원본 설정(상속=null). { enabled: null|bool, categories: null|string[] } */
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

  /** 부분 갱신. patch에 준 키만 변경(enabled/categories). null 전달 시 "상속"으로 되돌림. */
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
   * 유효 SponsorBlock 설정. { enabled, categories }.
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
