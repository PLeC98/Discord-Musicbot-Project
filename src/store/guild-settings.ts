import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import { z } from "zod";
import { settingsDb } from "./settings-db.ts";
import config from "../config/index.ts";
import { codeOf } from "../rules/error-kind.ts";

// 재생목록 한 번에 넣는 곡 수의 위쪽 끝. 대기열 상한이 더 작으면 그쪽을 따른다
const PLAYLIST_ADD_CEILING = 1000;

/** 서버별 SponsorBlock 설정. null 은 전역을 따른다 */
type SponsorBlockSetting = { enabled: boolean | null; categories: string[] | null };

// 열기 전에 부르면 던진다
const conn = () => settingsDb.get();

// 열기 전에 부른 것은 조립 순서가 틀린 것이다. 그 서버의 설정이 없다는 뜻이 아니니 기본값으로 삼키지 않는다
function unlessNotOpen(error: unknown) {
  if (codeOf(error) === "DB_NOT_OPEN") throw error;
}

// 서버 설정 문서. 칸마다 따로 본다: 한 칸이 틀렸다고 다른 칸까지 버리지 않는다(틀린 칸은 정하지 않은 것으로)
const FIELDS = {
  botChannelId: z.string().min(1),
  djRoleIds: z.array(z.string().min(1)).min(1),
  sponsorBlock: z.object({ enabled: z.boolean().nullable().optional(), categories: z.array(z.string()).nullable().optional() }),
  playlistAddMax: z.number().int().positive(),
};
type GuildDoc = { [K in keyof typeof FIELDS]?: z.infer<(typeof FIELDS)[K]> };

// 이미 알린 틀린 문서(서버 · 내용). 곡마다 읽는 칸이 있어 같은 문서를 되풀이해 알리지 않는다
const warned = new Set<string>();
function warnOnce(guildId: string, raw: string, line: string) {
  const key = `${guildId}|${raw}`;
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(line);
}

// 문서를 읽어 칸마다 맞춘다. 틀린 칸은 버리고 한 줄 남긴다
function shapeOf(guildId: string, raw: string): GuildDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnOnce(guildId, raw, `서버 ${guildId} 설정이 JSON 이 아니어서 기본값을 씁니다`);
    return {};
  }
  const source = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const doc: Record<string, unknown> = {};
  const wrong: string[] = [];
  for (const [key, schema] of Object.entries(FIELDS)) {
    if (source[key] === undefined) continue;
    const checked = schema.safeParse(source[key]);
    if (checked.success) doc[key] = checked.data;
    else wrong.push(key);
  }
  if (wrong.length) warnOnce(guildId, raw, `서버 ${guildId} 설정의 ${wrong.join(", ")} 값이 틀려 그 값은 기본값을 씁니다`);
  return doc as GuildDoc;
}

function readDoc(guildId: string): GuildDoc {
  const row = conn().prepare("SELECT data_json FROM guild_settings WHERE guild_id = ?").get(guildId) as { data_json: string } | undefined;
  return row ? shapeOf(guildId, row.data_json) : {};
}

// 한 칸을 바꿔 쓴다. 읽고 쓰는 사이에 다른 쓰기가 끼지 않게 한 트랜잭션. 빈 문서가 되면 줄을 지운다
function writeField<K extends keyof GuildDoc>(guildId: string, key: K, value: GuildDoc[K] | undefined) {
  conn().transaction(() => {
    const doc = readDoc(guildId);
    if (value === undefined) delete doc[key];
    else doc[key] = value;
    if (!Object.keys(doc).length) {
      conn().prepare("DELETE FROM guild_settings WHERE guild_id = ?").run(guildId);
      return;
    }
    conn()
      .prepare(
        `INSERT INTO guild_settings (guild_id, data_json, revision, updated_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
             data_json  = excluded.data_json,
             revision   = guild_settings.revision + 1,
             updated_at = excluded.updated_at`,
      )
      .run(guildId, JSON.stringify(doc), Date.now());
  })();
}

// 서버 설정 문서를 한 칸씩 읽고 쓴다. 아래 함수들이 메모리 캐시를 얹는다
const table = {
  getBotChannel(guildId: string): string | null {
    return readDoc(guildId).botChannelId ?? null;
  },

  setBotChannel(guildId: string, channelId: string) {
    writeField(guildId, "botChannelId", channelId);
  },

  clearBotChannel(guildId: string) {
    writeField(guildId, "botChannelId", undefined);
  },

  /** DJ 역할 ID 목록. 미설정이면 빈 배열 */
  getDjRoles(guildId: string): string[] {
    return readDoc(guildId).djRoleIds ?? [];
  },

  setDjRoles(guildId: string, roleIds: string[]) {
    writeField(guildId, "djRoleIds", roleIds.length ? roleIds : undefined); // 빈 배열 = 미설정과 동일
  },

  clearDjRoles(guildId: string) {
    writeField(guildId, "djRoleIds", undefined);
  },

  /** 서버별 SponsorBlock 설정. { enabled: null|bool, categories: null|string[] } (null=전역 상속) */
  getGuildSponsorBlock(guildId: string): SponsorBlockSetting {
    const sb = readDoc(guildId).sponsorBlock;
    return { enabled: sb?.enabled ?? null, categories: sb?.categories ?? null };
  },

  /** 서버별 SponsorBlock 설정 저장. enabled/categories 각각 null이면 "상속"으로 기록. */
  setGuildSponsorBlock(guildId: string, { enabled, categories }: Partial<SponsorBlockSetting>) {
    const next = { enabled: typeof enabled === "boolean" ? enabled : null, categories: Array.isArray(categories) ? categories : null };
    writeField(guildId, "sponsorBlock", next.enabled === null && next.categories === null ? undefined : next);
  },

  /** 재생목록을 넣을 때 한 번에 들어가는 곡 수. 미설정이면 null */
  getPlaylistAddMax(guildId: string): number | null {
    return readDoc(guildId).playlistAddMax ?? null;
  },

  /** null이면 기본값으로 되돌린다 */
  setPlaylistAddMax(guildId: string, count: number | null | undefined) {
    writeField(guildId, "playlistAddMax", count ?? undefined);
  },
};

// 서버 · 칸마다 담아 두는 값. 키는 `${guildId}_${칸}`
type Cached = { botChannel: string | null; djRoles: string[]; playlistAdd: number | null; sb: SponsorBlockSetting };

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
    unlessNotOpen(error);
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
  } catch (error) {
    unlessNotOpen(error);
    log.error("전용 채널 읽기 실패:", error);
    return null;
  }
}

async function clearBotChannel(guildId: string) {
  try {
    table.clearBotChannel(guildId);
  } catch (error) {
    unlessNotOpen(error);
    log.error("전용 채널 지우기 실패:", error);
  }
  cache.delete(`${guildId}_botChannel`);
}

async function setDjRoles(guildId: string, roleIds: string[]) {
  try {
    table.setDjRoles(guildId, roleIds);
    remember(guildId, "djRoles", roleIds);
    return true;
  } catch (error) {
    unlessNotOpen(error);
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
  } catch (error) {
    unlessNotOpen(error);
    log.error("DJ 역할 읽기 실패:", error);
    return [];
  }
}

async function clearDjRoles(guildId: string) {
  try {
    table.clearDjRoles(guildId);
  } catch (error) {
    unlessNotOpen(error);
    log.error("DJ 역할 지우기 실패:", error);
  }
  cache.delete(`${guildId}_djRoles`);
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
  try {
    const value = table.getPlaylistAddMax(guildId);
    remember(guildId, "playlistAdd", value);
    return value;
  } catch (error) {
    unlessNotOpen(error);
    log.error("재생목록 한 번에 넣는 곡 수 읽기 실패(기본값을 쓴다):", error);
    return null;
  }
}

/** null이면 기본값으로 되돌린다. 범위 검증은 호출자 몫(명령·대시보드가 사용자에게 알린다). */
async function setPlaylistAddMax(guildId: string, count: number | null | undefined) {
  try {
    table.setPlaylistAddMax(guildId, count);
    remember(guildId, "playlistAdd", count ?? null);
    return true;
  } catch (error) {
    unlessNotOpen(error);
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
  if (stored === undefined && settingsDb.isOpen()) {
    try {
      stored = table.getPlaylistAddMax(guildId);
      remember(guildId, "playlistAdd", stored);
    } catch (error) {
      log.error("재생목록 한 번에 넣는 곡 수 읽기 실패(기본값을 쓴다):", error);
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
  try {
    const v = table.getGuildSponsorBlock(guildId);
    remember(guildId, "sb", v);
    return v;
  } catch (error) {
    unlessNotOpen(error);
    log.error("SponsorBlock 설정 읽기 실패(전역을 따른다):", error);
    return { enabled: null, categories: null };
  }
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
    unlessNotOpen(error);
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
  } catch (error) {
    unlessNotOpen(error);
    log.error("SponsorBlock 설정 읽기 실패(전역을 따른다):", error);
    per = { enabled: null, categories: null };
  }
  return {
    enabled: per.enabled === null ? true : per.enabled,
    categories: per.categories ?? master.categories,
  };
}

export { table, _reset, setBotChannel, getBotChannel, clearBotChannel, setDjRoles, getDjRoles, clearDjRoles, playlistAddLimits, getPlaylistAddMax, setPlaylistAddMax, resolvePlaylistAddMax, getSponsorBlock, setSponsorBlock, resolveSponsorBlock };
export type { SponsorBlockSetting };
