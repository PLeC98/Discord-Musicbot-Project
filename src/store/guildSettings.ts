import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import * as db from "./db.ts";
import config from "../../config.ts";

// 재생목록 한 번에 넣는 곡 수의 위쪽 끝. 대기열 상한이 더 작으면 그쪽을 따른다
const PLAYLIST_ADD_CEILING = 1000;

/** 서버별 SponsorBlock 설정. null 은 전역을 따른다 */
type SponsorBlockSetting = { enabled: boolean | null; categories: string[] | null };
/** 현재 재생 패널의 자리 */
type PanelRecord = { channelId: string | null; messageId: string };

// 열기 전에 부르면 던진다
const conn = () => db.get();

// 서버 설정 표(guild_settings)를 한 칸씩 읽고 쓴다. 아래 함수들이 메모리 캐시를 얹는다
const table = {
  // 서버 설정

  getBotChannel(guildId: string): string | null {
    const row = conn().prepare("SELECT bot_channel_id FROM guild_settings WHERE guild_id = ?").get(guildId) as { bot_channel_id: string | null } | undefined;
    return row?.bot_channel_id ?? null;
  },

  setBotChannel(guildId: string, channelId: string) {
    conn()
      .prepare(
        `
            INSERT INTO guild_settings (guild_id, bot_channel_id, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                bot_channel_id = excluded.bot_channel_id,
                updated_at     = excluded.updated_at
        `,
      )
      .run(guildId, channelId, Date.now());
  },

  clearBotChannel(guildId: string) {
    // 행에는 다른 설정(dj_role_ids)도 담겨 있으므로 행 삭제가 아닌 컬럼 초기화
    conn().prepare("UPDATE guild_settings SET bot_channel_id = NULL, updated_at = ? WHERE guild_id = ?").run(Date.now(), guildId);
  },

  /** DJ 역할 ID 목록. 미설정이면 빈 배열 */
  getDjRoles(guildId: string): string[] {
    const row = conn().prepare("SELECT dj_role_ids FROM guild_settings WHERE guild_id = ?").get(guildId) as { dj_role_ids: string | null } | undefined;
    if (!row?.dj_role_ids) return [];
    try {
      const parsed: unknown = JSON.parse(row.dj_role_ids);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  },

  setDjRoles(guildId: string, roleIds: string[]) {
    const value = roleIds.length ? JSON.stringify(roleIds) : null; // 빈 배열 = 미설정과 동일
    conn()
      .prepare(
        `
            INSERT INTO guild_settings (guild_id, dj_role_ids, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                dj_role_ids = excluded.dj_role_ids,
                updated_at  = excluded.updated_at
        `,
      )
      .run(guildId, value, Date.now());
  },

  clearDjRoles(guildId: string) {
    conn().prepare("UPDATE guild_settings SET dj_role_ids = NULL, updated_at = ? WHERE guild_id = ?").run(Date.now(), guildId);
  },

  /** 서버별 SponsorBlock 설정. { enabled: null|bool, categories: null|string[] } (null=전역 상속) */
  getGuildSponsorBlock(guildId: string): SponsorBlockSetting {
    const row = conn().prepare("SELECT sponsorblock_enabled, sponsorblock_categories FROM guild_settings WHERE guild_id = ?").get(guildId) as { sponsorblock_enabled: number | null; sponsorblock_categories: string | null } | undefined;
    if (!row) return { enabled: null, categories: null };
    let categories: string[] | null = null;
    if (row.sponsorblock_categories) {
      try {
        const p: unknown = JSON.parse(row.sponsorblock_categories);
        if (Array.isArray(p)) categories = p as string[];
      } catch {
        /* 손상 값은 상속 취급 */
      }
    }
    const enabled = row.sponsorblock_enabled === null || row.sponsorblock_enabled === undefined ? null : !!row.sponsorblock_enabled;
    return { enabled, categories };
  },

  /** 서버별 SponsorBlock 설정 저장. enabled/categories 각각 null이면 "상속"으로 기록. */
  setGuildSponsorBlock(guildId: string, { enabled, categories }: Partial<SponsorBlockSetting>) {
    const encEnabled = enabled === null || enabled === undefined ? null : enabled ? 1 : 0;
    const encCats = Array.isArray(categories) ? JSON.stringify(categories) : null;
    conn()
      .prepare(
        `INSERT INTO guild_settings (guild_id, sponsorblock_enabled, sponsorblock_categories, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             sponsorblock_enabled    = excluded.sponsorblock_enabled,
             sponsorblock_categories = excluded.sponsorblock_categories,
             updated_at              = excluded.updated_at`,
      )
      .run(guildId, encEnabled, encCats, Date.now());
  },

  /** 재생목록을 넣을 때 한 번에 들어가는 곡 수. 미설정이면 null */
  getPlaylistAddMax(guildId: string): number | null {
    const row = conn().prepare("SELECT playlist_add_max FROM guild_settings WHERE guild_id = ?").get(guildId) as { playlist_add_max: number | null } | undefined;
    return row?.playlist_add_max ?? null;
  },

  /** null이면 기본값으로 되돌린다 */
  setPlaylistAddMax(guildId: string, count: number | null | undefined) {
    conn()
      .prepare(
        `INSERT INTO guild_settings (guild_id, playlist_add_max, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             playlist_add_max = excluded.playlist_add_max,
             updated_at       = excluded.updated_at`,
      )
      .run(guildId, count ?? null, Date.now());
  },

  /** 이 서버의 현재 재생 패널 자리. 없으면 null */
  getPanelRecord(guildId: string): PanelRecord | null {
    const row = conn().prepare("SELECT now_playing_channel_id AS channelId, now_playing_message_id AS messageId FROM guild_settings WHERE guild_id = ?").get(guildId) as { channelId: string | null; messageId: string | null } | undefined;
    return row?.messageId ? { channelId: row.channelId, messageId: row.messageId } : null;
  },

  /** messageId가 null이면 비운다 */
  setPanelRecord(guildId: string, channelId: string | null, messageId: string | null | undefined) {
    conn()
      .prepare(
        `INSERT INTO guild_settings (guild_id, now_playing_channel_id, now_playing_message_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             now_playing_channel_id = excluded.now_playing_channel_id,
             now_playing_message_id = excluded.now_playing_message_id,
             updated_at             = excluded.updated_at`,
      )
      .run(guildId, messageId ? channelId : null, messageId ?? null, Date.now());
  },
};

// 서버 · 칸마다 담아 두는 값. 키는 `${guildId}_${칸}`
type Cached = { botChannel: string | null; djRoles: string[]; panel: PanelRecord | null; playlistAdd: number | null; sb: SponsorBlockSetting };

const cache = new Map<string, Cached[keyof Cached]>();

// 테스트 시임. 읽어 둔 것을 버린다(임시 DB 에 바로 쓴 뒤 등)
function _reset() {
  cache.clear();
}

function cached<K extends keyof Cached>(guildId: string, kind: K): Cached[K] | undefined {
  return cache.get(`${guildId}_${kind}`) as Cached[K] | undefined;
}

function remember<K extends keyof Cached>(guildId: string, kind: K, value: Cached[K]) {
  cache.set(`${guildId}_${kind}`, value);
}

async function setBotChannel(guildId: string, channelId: string) {
  try {
    table.setBotChannel(guildId, channelId);
    remember(guildId, "botChannel", channelId);
    return true;
  } catch (error) {
    log.error("전용 채널 저장 실패:", error);
    return false;
  }
}

async function getBotChannel(guildId: string): Promise<string | null> {
  const hit = cached(guildId, "botChannel");
  if (hit !== undefined) return hit;
  try {
    const channelId = table.getBotChannel(guildId);
    remember(guildId, "botChannel", channelId);
    return channelId;
  } catch {
    remember(guildId, "botChannel", null);
    return null;
  }
}

async function clearBotChannel(guildId: string) {
  try {
    table.clearBotChannel(guildId);
  } catch {}
  cache.delete(`${guildId}_botChannel`);
}

async function setDjRoles(guildId: string, roleIds: string[]) {
  try {
    table.setDjRoles(guildId, roleIds);
    remember(guildId, "djRoles", roleIds);
    return true;
  } catch (error) {
    log.error("DJ 역할 저장 실패:", error);
    return false;
  }
}

/** DJ 역할 ID 목록. 미설정이면 빈 배열 */
async function getDjRoles(guildId: string): Promise<string[]> {
  const hit = cached(guildId, "djRoles");
  if (hit !== undefined) return hit;
  try {
    const roleIds = table.getDjRoles(guildId);
    remember(guildId, "djRoles", roleIds);
    return roleIds;
  } catch {
    remember(guildId, "djRoles", []);
    return [];
  }
}

async function clearDjRoles(guildId: string) {
  try {
    table.clearDjRoles(guildId);
  } catch {}
  cache.delete(`${guildId}_djRoles`);
}

// ── 현재 재생 패널 자리. 사용자 설정이 아니라 옛 패널을 치우는 기준 ─────────

/** { channelId, messageId } 또는 null */
async function getPanel(guildId: string): Promise<PanelRecord | null> {
  const hit = cached(guildId, "panel");
  if (hit !== undefined) return hit;
  let record = null;
  try {
    record = table.getPanelRecord(guildId);
  } catch {
    /* 읽지 못하면 옛 패널을 못 치울 뿐이다 */
  }
  remember(guildId, "panel", record);
  return record;
}

/** messageId가 null이면 비운다 */
async function setPanel(guildId: string, channelId: string | null, messageId: string | null | undefined) {
  try {
    table.setPanelRecord(guildId, channelId, messageId);
    remember(guildId, "panel", messageId ? { channelId, messageId } : null);
  } catch (error) {
    log.error("현재 재생 패널 자리 저장 실패:", error);
  }
}

// ── 재생목록 한 번에 넣는 곡 수 ─────────────────────────────────────────────
// 첫 묶음과 "더 넣기" 선택지 단위를 정한다. 더 넣기 자체는 대기열 상한만 본다.

/** 설정할 수 있는 범위와 기본값 */
function playlistAddLimits() {
  const queueMax = config.bot.maxQueueSize;
  return { min: 1, max: queueMax > 0 ? Math.min(PLAYLIST_ADD_CEILING, queueMax) : PLAYLIST_ADD_CEILING, default: config.bot.playlistAddDefault };
}

/** 서버가 정한 값. 미설정이면 null */
async function getPlaylistAddMax(guildId: string): Promise<number | null> {
  const hit = cached(guildId, "playlistAdd");
  if (hit !== undefined) return hit;
  let value = null;
  try {
    value = table.getPlaylistAddMax(guildId);
  } catch {
    /* 읽지 못하면 기본값 */
  }
  remember(guildId, "playlistAdd", value);
  return value;
}

/** null이면 기본값으로 되돌린다. 범위 검증은 호출자 몫(명령·대시보드가 사용자에게 알린다). */
async function setPlaylistAddMax(guildId: string, count: number | null | undefined) {
  try {
    table.setPlaylistAddMax(guildId, count);
    remember(guildId, "playlistAdd", count ?? null);
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
function resolvePlaylistAddMax(guildId: string): number {
  const { min, max, default: fallback } = playlistAddLimits();
  let stored = cached(guildId, "playlistAdd");
  if (stored === undefined && db.isOpen()) {
    try {
      stored = table.getPlaylistAddMax(guildId);
      remember(guildId, "playlistAdd", stored);
    } catch {
      stored = null;
    }
  }
  return Math.max(min, Math.min(max, stored ?? fallback));
}

// ── SponsorBlock 서버별 설정 ────────────────────────────────────────────────

/** 서버별 원본 설정(상속=null). { enabled: null|bool, categories: null|string[] } */
async function getSponsorBlock(guildId: string): Promise<SponsorBlockSetting> {
  const hit = cached(guildId, "sb");
  if (hit !== undefined) return hit;
  let v;
  try {
    v = table.getGuildSponsorBlock(guildId);
  } catch {
    v = { enabled: null, categories: null };
  }
  remember(guildId, "sb", v);
  return v;
}

/** 부분 갱신. patch에 준 키만 변경(enabled/categories). null 전달 시 "상속"으로 되돌림. */
async function setSponsorBlock(guildId: string, patch: Partial<SponsorBlockSetting>) {
  const cur = await getSponsorBlock(guildId);
  const next = {
    enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
    categories: patch.categories !== undefined ? patch.categories : cur.categories,
  };
  try {
    table.setGuildSponsorBlock(guildId, next);
    remember(guildId, "sb", next);
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
function resolveSponsorBlock(guildId: string): { enabled: boolean; categories: string[] } {
  const master = config.sponsorblock;
  if (!master.enabled) return { enabled: false, categories: [] };
  let per: SponsorBlockSetting;
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

export { table, _reset, setBotChannel, getBotChannel, clearBotChannel, setDjRoles, getDjRoles, clearDjRoles, getPanel, setPanel, playlistAddLimits, getPlaylistAddMax, setPlaylistAddMax, resolvePlaylistAddMax, getSponsorBlock, setSponsorBlock, resolveSponsorBlock };
export type { SponsorBlockSetting, PanelRecord };
