// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import db from "./db.ts";
import config from "../../config.ts";

// 재생목록 한 번에 넣는 곡 수의 위쪽 끝. 대기열 상한이 더 작으면 그쪽을 따른다
const PLAYLIST_ADD_CEILING = 1000;

// 서버 설정 표(guild_settings)를 한 칸씩 읽고 쓴다. 아래 GuildSettingsManager 가 메모리 캐시를 얹는다
class GuildSettingsTable {
  get db() {
    return db.get();
  }

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

const table = new GuildSettingsTable();

class GuildSettingsManager {
  constructor() {
    this.cache = new Map();
  }

  async setBotChannel(guildId, channelId) {
    try {
      table.setBotChannel(guildId, channelId);
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
      const channelId = table.getBotChannel(guildId);
      this.cache.set(key, channelId);
      return channelId;
    } catch {
      this.cache.set(key, null);
      return null;
    }
  }

  async clearBotChannel(guildId) {
    try {
      table.clearBotChannel(guildId);
    } catch {}
    this.cache.delete(`${guildId}_botChannel`);
  }

  async setDjRoles(guildId, roleIds) {
    try {
      table.setDjRoles(guildId, roleIds);
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
      const roleIds = table.getDjRoles(guildId);
      this.cache.set(key, roleIds);
      return roleIds;
    } catch {
      this.cache.set(key, []);
      return [];
    }
  }

  async clearDjRoles(guildId) {
    try {
      table.clearDjRoles(guildId);
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
      record = table.getPanelRecord(guildId);
    } catch {
      /* 읽지 못하면 옛 패널을 못 치울 뿐이다 */
    }
    this.cache.set(key, record);
    return record;
  }

  /** messageId가 null이면 비운다 */
  async setPanel(guildId, channelId, messageId) {
    try {
      table.setPanelRecord(guildId, channelId, messageId);
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
      value = table.getPlaylistAddMax(guildId);
    } catch {
      /* 읽지 못하면 기본값 */
    }
    this.cache.set(key, value);
    return value;
  }

  /** null이면 기본값으로 되돌린다. 범위 검증은 호출자 몫(명령·대시보드가 사용자에게 알린다). */
  async setPlaylistAddMax(guildId, count) {
    try {
      table.setPlaylistAddMax(guildId, count);
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
    if (stored === undefined && db.isOpen()) {
      try {
        stored = table.getPlaylistAddMax(guildId);
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
      v = table.getGuildSponsorBlock(guildId);
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
      table.setGuildSponsorBlock(guildId, next);
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
      per = table.getGuildSponsorBlock(guildId);
    } catch {
      per = { enabled: null, categories: null };
    }
    return {
      enabled: per.enabled === null ? true : per.enabled,
      categories: per.categories ?? master.categories,
    };
  }
}

const exported = new GuildSettingsManager();
export default exported;
export { exported as "module.exports" };
exported.table = table;
