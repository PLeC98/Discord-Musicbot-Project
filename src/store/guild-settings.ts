// 서버별 설정(settings.db 의 guild_settings). 서버마다 JSON 문서 하나. 쓰기는 update 한 곳에서 한 트랜잭션으로 한다. 읽은 값은 메모리에 담아 두고, 설정이 바뀌면 리스너에 알린다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "guild" });
import { z } from "zod";
import { settingsDb } from "./settings-db.ts";
import config from "../config/index.ts";
import { codeOf } from "../rules/error-kind.ts";
import { AGE_PLACES, type AgePlace } from "../rules/age-place.ts";
import { VOLUME_MAX } from "../rules/limits.ts";
import { sameValue, type SettingsKey } from "../rules/guild-settings-values.ts";

// 재생목록 한 번에 넣는 곡 수의 상한. 대기열 상한이 더 작으면 그쪽을 따른다
const PLAYLIST_ADD_CEILING = 1000;

/** 서버별 SponsorBlock 설정. null 은 전역을 따른다 */
type SponsorBlockSetting = { enabled: boolean | null; categories: string[] | null };

// 열기 전에 부르면 던진다
const conn = () => settingsDb.get();

// 열기 전에 부른 것은 조립 순서가 틀린 것이다. 그 서버의 설정이 없다는 뜻이 아니니 기본값으로 삼키지 않는다
function unlessNotOpen(error: unknown) {
  if (codeOf(error) === "DB_NOT_OPEN") throw error;
}

// 서버 설정 문서. 필드마다 따로 본다: 한 필드가 틀렸다고 다른 필드까지 버리지 않는다(틀린 필드는 지정하지 않은 것으로)
const FIELDS = {
  botChannelId: z.string().min(1),
  djRoleIds: z.array(z.string().min(1)).min(1),
  sponsorBlock: z.object({ enabled: z.boolean().nullable().optional(), categories: z.array(z.string()).nullable().optional() }),
  playlistAddMax: z.number().int().positive(),
  agePlace: z.enum(AGE_PLACES),
  volume: z.number().int().min(0).max(VOLUME_MAX),
  normalize: z.boolean(),
};
type GuildDoc = { [K in keyof typeof FIELDS]?: z.infer<(typeof FIELDS)[K]> };

// 이미 알린 틀린 문서(서버, 내용). 곡마다 읽는 필드가 있어 같은 문서를 되풀이해 알리지 않는다
const warned = new Set<string>();
function warnOnce(guildId: string, raw: string, line: string) {
  const key = `${guildId}|${raw}`;
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(line);
}

// 문서를 읽어 필드마다 맞춘다. 틀린 필드는 버리고 한 줄 남긴다
function shapeOf(guildId: string, raw: string): GuildDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnOnce(guildId, raw, `서버 ${guildId} 설정 읽기 실패(기본값 사용): 올바른 JSON 형식이 아님`);
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
  if (wrong.length) warnOnce(guildId, raw, `서버 ${guildId} 설정의 ${wrong.join(", ")} 값 검증 실패(기본값 사용)`);
  return doc as GuildDoc;
}

function readDoc(guildId: string): GuildDoc {
  const row = conn().prepare("SELECT data_json FROM guild_settings WHERE guild_id = ?").get(guildId) as { data_json: string } | undefined;
  return row ? shapeOf(guildId, row.data_json) : {};
}

type GuildField = keyof GuildDoc;
const GUILD_FIELDS = Object.keys(FIELDS) as GuildField[];

/** 로그에 쓰는 필드 이름 */
const FIELD_LABEL: Readonly<Record<GuildField, string>> = {
  botChannelId: "전용 채널",
  djRoleIds: "DJ 역할",
  sponsorBlock: "SponsorBlock",
  playlistAddMax: "재생목록 한 번에 넣을 곡 수",
  agePlace: "연령 제한 콘텐츠를 틀 곳",
  volume: "볼륨",
  normalize: "볼륨 정규화",
};

/**
 * update 에 넘기는 패치. 빠진 필드는 그대로 두고, null 이면 그 필드를 지운다(기본값으로 돌아간다).
 * djRoleIds 가 [] 이면 지운다. sponsorBlock 은 넘긴 하위 키만 바꾸고, 하위 키가 null 이면 전역 설정을 따른다.
 * agePlace 가 "channel", volume 이 기본 볼륨, normalize 가 false 면 기본값이라 문서에서 뺀다
 */
type GuildPatch = {
  botChannelId?: string | null;
  djRoleIds?: string[];
  sponsorBlock?: Partial<SponsorBlockSetting>;
  playlistAddMax?: number | null;
  agePlace?: AgePlace;
  volume?: number;
  normalize?: boolean;
};

// 필드마다 패치 값을 문서에 남길 값으로 바꾼다. undefined 면 문서에서 뺀다(기본값과 같은 값은 빼서 서버가 정한 값만 남긴다)
const STORED: { [F in GuildField]: (value: Exclude<GuildPatch[F], undefined>, doc: GuildDoc) => GuildDoc[F] | undefined } = {
  botChannelId: (value) => value ?? undefined,
  djRoleIds: (value) => (value.length ? value : undefined),
  sponsorBlock: (value, doc) => {
    const enabled = value.enabled !== undefined ? value.enabled : (doc.sponsorBlock?.enabled ?? null);
    const categories = value.categories !== undefined ? value.categories : (doc.sponsorBlock?.categories ?? null);
    return enabled === null && categories === null ? undefined : { enabled, categories };
  },
  playlistAddMax: (value) => value ?? undefined,
  agePlace: (value) => (value === "channel" ? undefined : value),
  volume: (value) => (value === config.bot.defaultVolume ? undefined : value),
  normalize: (value) => (value ? true : undefined),
};

// 패치를 반영한 새 문서
function applyPatch(doc: GuildDoc, patch: GuildPatch): GuildDoc {
  const next: Record<string, unknown> = { ...doc };
  for (const field of GUILD_FIELDS) {
    if (patch[field] === undefined) continue;
    const value = (STORED[field] as (value: unknown, doc: GuildDoc) => unknown)(patch[field], doc);
    if (value === undefined) delete next[field];
    else next[field] = value;
  }
  return next as GuildDoc;
}

// 저장된 두 값이 같은지 본다. 역할, 구간은 순서와 중복을 따지지 않는다
function sameStored<K extends GuildField>(field: K, a: GuildDoc[K], b: GuildDoc[K]): boolean {
  if (field === "djRoleIds") return sameValue("djRoleIds", a ?? null, b ?? null);
  if (field === "sponsorBlock") {
    const x = a as GuildDoc["sponsorBlock"];
    const y = b as GuildDoc["sponsorBlock"];
    if (!x || !y) return !x && !y;
    return (x.enabled ?? null) === (y.enabled ?? null) && sameValue("sponsorblock.categories", x.categories ?? null, y.categories ?? null);
  }
  return a === b;
}

// 빈 문서면 행을 지운다
function writeDoc(guildId: string, doc: GuildDoc) {
  if (!Object.keys(doc).length) {
    conn().prepare("DELETE FROM guild_settings WHERE guild_id = ?").run(guildId);
    return;
  }
  conn()
    .prepare(
      `INSERT INTO guild_settings (guild_id, data_json) VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET data_json = excluded.data_json`,
    )
    .run(guildId, JSON.stringify(doc));
}

// 캐시 갱신과 바뀜 알림 없이 쓴다(table). 읽고 쓰는 사이에 다른 쓰기가 끼지 않게 한 트랜잭션으로 묶는다
function writePatch(guildId: string, patch: GuildPatch) {
  conn().transaction(() => writeDoc(guildId, applyPatch(readDoc(guildId), patch)))();
}

// 서버 설정 문서를 한 필드씩 읽고 쓴다. 아래 함수들이 메모리 캐시를 얹는다
const table = {
  getBotChannel(guildId: string): string | null {
    return readDoc(guildId).botChannelId ?? null;
  },

  setBotChannel(guildId: string, channelId: string) {
    writePatch(guildId, { botChannelId: channelId });
  },

  clearBotChannel(guildId: string) {
    writePatch(guildId, { botChannelId: null });
  },

  /** DJ 역할 ID 목록. 미설정이면 빈 배열 */
  getDjRoles(guildId: string): string[] {
    return readDoc(guildId).djRoleIds ?? [];
  },

  setDjRoles(guildId: string, roleIds: string[]) {
    writePatch(guildId, { djRoleIds: roleIds }); // 빈 배열은 지정하지 않은 것과 같다
  },

  clearDjRoles(guildId: string) {
    writePatch(guildId, { djRoleIds: [] });
  },

  /** 서버별 SponsorBlock 설정. 필드가 null 이면 전역 설정을 따른다 */
  getGuildSponsorBlock(guildId: string): SponsorBlockSetting {
    const sb = readDoc(guildId).sponsorBlock;
    return { enabled: sb?.enabled ?? null, categories: sb?.categories ?? null };
  },

  /** 서버별 SponsorBlock 설정 저장. enabled, categories 가 null 이면 전역을 따른다(둘 다 null 이면 필드를 뺀다) */
  setGuildSponsorBlock(guildId: string, { enabled, categories }: Partial<SponsorBlockSetting>) {
    writePatch(guildId, { sponsorBlock: { enabled: typeof enabled === "boolean" ? enabled : null, categories: Array.isArray(categories) ? categories : null } });
  },

  /** 재생목록을 넣을 때 한 번에 들어가는 곡 수. 미설정이면 null */
  getPlaylistAddMax(guildId: string): number | null {
    return readDoc(guildId).playlistAddMax ?? null;
  },

  /** null이면 기본값으로 되돌린다 */
  setPlaylistAddMax(guildId: string, count: number | null | undefined) {
    writePatch(guildId, { playlistAddMax: count ?? null });
  },

  /** 연령 제한 콘텐츠를 틀 곳. 미설정이면 연령 제한 채널에서만 */
  getAgePlace(guildId: string): AgePlace {
    return readDoc(guildId).agePlace ?? "channel";
  },

  /** 기본값(연령 제한 채널에서만)이면 필드를 뺀다 */
  setAgePlace(guildId: string, place: AgePlace) {
    writePatch(guildId, { agePlace: place });
  },

  /** 마지막으로 정한 볼륨. 미설정이면 null */
  getVolume(guildId: string): number | null {
    return readDoc(guildId).volume ?? null;
  },

  /** 기본 볼륨이면 필드를 뺀다 */
  setVolume(guildId: string, level: number) {
    writePatch(guildId, { volume: level });
  },

  /** 볼륨 정규화 켜짐 여부. 미설정이면 끔 */
  getNormalize(guildId: string): boolean {
    return readDoc(guildId).normalize ?? false;
  },

  /** 끄면(기본값) 필드를 뺀다 */
  setNormalize(guildId: string, on: boolean) {
    writePatch(guildId, { normalize: on });
  },
};

/** 설정이 있는 서버 수(초기화 카드) */
function guildCount(): number {
  return conn().prepare("SELECT COUNT(*) FROM guild_settings").pluck().get() as number;
}

/** 모든 서버의 설정을 지운다(서버별 설정 초기화). 캐시도 비우고, 커밋 뒤 설정이 있던 서버마다 지운 필드를 알린다. 실패하면 던진다 */
function removeAll() {
  const removed = conn().transaction(() => {
    const rows = conn().prepare("SELECT guild_id, data_json FROM guild_settings").all() as Array<{ guild_id: string; data_json: string }>;
    conn().prepare("DELETE FROM guild_settings").run();
    return rows;
  })();
  forgetCache();
  for (const row of removed) announce(row.guild_id, Object.keys(shapeOf(row.guild_id, row.data_json)) as GuildField[]);
}

// 서버, 필드마다 담아 두는 값. 키는 `${guildId}_${필드}`
type Cached = { botChannel: string | null; djRoles: string[]; playlistAdd: number | null; sb: SponsorBlockSetting; agePlace: AgePlace; volume: number | null; normalize: boolean };

const cache = new Map<string, Cached[keyof Cached]>();

/** 읽어 둔 것을 버린다. 표를 통째로 바꾼 뒤(불러오기, 초기화, 테스트가 임시 DB 에 바로 쓴 뒤) */
function forgetCache() {
  cache.clear();
}

function cached<K extends keyof Cached>(guildId: string, kind: K): Cached[K] | undefined {
  return cache.get(`${guildId}_${kind}`) as Cached[K] | undefined;
}

function remember<K extends keyof Cached>(guildId: string, kind: K, value: Cached[K]) {
  cache.set(`${guildId}_${kind}`, value);
}

// 문서 필드마다 캐시 키와 담을 값. 문서 키, 캐시 키, 비었을 때의 값이 필드마다 달라 여기 한곳에 모은다
const CACHED_AS: { [F in GuildField]: (doc: GuildDoc) => [keyof Cached, Cached[keyof Cached]] } = {
  botChannelId: (doc) => ["botChannel", doc.botChannelId ?? null],
  djRoleIds: (doc) => ["djRoles", doc.djRoleIds ?? []],
  sponsorBlock: (doc) => ["sb", { enabled: doc.sponsorBlock?.enabled ?? null, categories: doc.sponsorBlock?.categories ?? null }],
  playlistAddMax: (doc) => ["playlistAdd", doc.playlistAddMax ?? null],
  agePlace: (doc) => ["agePlace", doc.agePlace ?? "channel"],
  volume: (doc) => ["volume", doc.volume ?? null],
  normalize: (doc) => ["normalize", doc.normalize ?? false],
};

function rememberField(guildId: string, doc: GuildDoc, field: GuildField) {
  const [kind, value] = CACHED_AS[field](doc);
  cache.set(`${guildId}_${kind}`, value);
}

type ChangeListener = (guildId: string, fields: GuildField[]) => void;
const listeners = new Set<ChangeListener>();

/** 서버 설정이 바뀌어 커밋된 뒤 부를 리스너를 붙인다(바뀐 필드를 넘긴다, volume 포함). 리스너의 오류는 저장에 번지지 않는다. 떼는 함수를 돌려준다 */
function onChanged(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(guildId: string, fields: GuildField[]) {
  if (!fields.length) return;
  for (const fn of listeners) {
    try {
      fn(guildId, fields);
    } catch (error) {
      log.error("서버 설정 변경 알림 처리 실패:", error);
    }
  }
}

/** update 의 결과. 충돌(check 가 키를 돌려준 경우)이면 아무것도 쓰지 않은 것이다. doc 은 쓴 뒤의 문서, 충돌이면 그때 읽은 문서 */
type Updated = { ok: true; changed: GuildField[]; doc: GuildDoc } | { ok: false; conflicts: SettingsKey[]; doc: GuildDoc };

/**
 * 받은 필드를 한 트랜잭션으로 쓴다. 바뀐 것이 없으면 쓰지 않는다.
 * check 는 트랜잭션 안에서 지금 문서를 보고 그사이 바뀐 키를 돌려준다. 돌려준 키가 없으면 쓴다.
 * 커밋 뒤에는 바뀐 것이 없어도 패치에 든 필드의 캐시를 문서 값으로 채운다(읽기 실패로 남은 낡은 값을 고친다). 그다음 바뀐 필드를 알린다.
 * 쓰기에 실패하면 원래 오류를 그대로 던지고 캐시는 건드리지 않는다
 */
function update(guildId: string, patch: GuildPatch, check?: (doc: GuildDoc) => SettingsKey[]): Updated {
  const result = conn().transaction((): Updated => {
    const doc = readDoc(guildId);
    const conflicts = check?.(doc) ?? [];
    if (conflicts.length) return { ok: false, conflicts, doc };
    const next = applyPatch(doc, patch);
    const changed = GUILD_FIELDS.filter((field) => !sameStored(field, doc[field], next[field]));
    if (changed.length) writeDoc(guildId, next);
    return { ok: true, changed, doc: next };
  })();
  if (!result.ok) return result;
  for (const field of GUILD_FIELDS) if (patch[field] !== undefined) rememberField(guildId, result.doc, field);
  announce(guildId, result.changed);
  return result;
}

/** 캐시를 거치지 않고 서버 설정 문서를 행에서 바로 읽는다. 못 읽으면 던진다 */
function read(guildId: string): GuildDoc {
  return readDoc(guildId);
}

// 아래 얇은 쓰기 함수들이 함께 쓰는 부분. 바뀐 필드를 돌려준다
const write = (guildId: string, patch: GuildPatch): GuildField[] => {
  const result = update(guildId, patch);
  return result.ok ? result.changed : [];
};

// 아래 set*, clear*, saveVolume 은 update 를 부르고 바뀐 필드를 돌려준다. 실패하면 던진다

async function setBotChannel(guildId: string, channelId: string) {
  return write(guildId, { botChannelId: channelId });
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
  return write(guildId, { botChannelId: null });
}

async function setDjRoles(guildId: string, roleIds: string[]) {
  return write(guildId, { djRoleIds: roleIds });
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
  return write(guildId, { djRoleIds: [] });
}

// ── 재생목록 한 번에 넣는 곡 수 ──
// 첫 배치와 "더 넣기" 선택지 단위를 정한다. 더 넣기 자체는 대기열 상한만 본다.

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
    log.error("재생목록 1회 최대 추가 곡 수 읽기 실패(기본값 사용):", error);
    return null;
  }
}

/** null이면 기본값으로 되돌린다. 범위 검사는 부르는 쪽이 한다(명령, 대시보드가 사용자에게 알린다) */
async function setPlaylistAddMax(guildId: string, count: number | null | undefined) {
  return write(guildId, { playlistAddMax: count ?? null });
}

/**
 * 실제로 쓸 값. 읽을 때마다 범위로 자른다. 서버가 200을 정한 뒤 운영자가 대기열 상한을 줄일 수 있어서다.
 * DB 가 열리지 않았으면 읽지 않고 기본값을 쓴다(DB 를 열지 않고 부르는 테스트).
 */
function resolvePlaylistAddMax(guildId: string): number {
  const { min, max, default: fallback } = playlistAddLimits();
  let stored = cached(guildId, "playlistAdd");
  if (stored === undefined && settingsDb.isOpen()) {
    try {
      stored = table.getPlaylistAddMax(guildId);
      remember(guildId, "playlistAdd", stored);
    } catch (error) {
      log.error("재생목록 1회 최대 추가 곡 수 읽기 실패(기본값 사용):", error);
      stored = null;
    }
  }
  return Math.max(min, Math.min(max, stored ?? fallback));
}

// ── 연령 제한 콘텐츠를 틀 곳 ──

/** 이 서버에서 연령 제한 콘텐츠를 틀 곳. 곡을 찾거나 틀 때마다 부르므로 메모리에 담는다. DB 가 열리지 않았거나 못 읽으면 기본(연령 제한 채널에서만) */
function resolveAgePlace(guildId: string): AgePlace {
  const hit = cached(guildId, "agePlace");
  if (hit !== undefined) return hit;
  if (!settingsDb.isOpen()) return "channel";
  try {
    const value = table.getAgePlace(guildId);
    remember(guildId, "agePlace", value);
    return value;
  } catch (error) {
    log.error("연령 제한 콘텐츠 허용 범위 읽기 실패(연령 제한 채널만 허용으로 적용):", error);
    return "channel";
  }
}

async function setAgePlace(guildId: string, place: AgePlace) {
  return write(guildId, { agePlace: place });
}

// ── 볼륨 ──

/** 이 서버에서 새 플레이어가 시작할 볼륨(마지막으로 정한 값). DB 가 열리지 않았거나 못 읽으면 기본 볼륨 */
function resolveVolume(guildId: string): number {
  let stored = cached(guildId, "volume");
  if (stored === undefined && settingsDb.isOpen()) {
    try {
      stored = table.getVolume(guildId);
      remember(guildId, "volume", stored);
    } catch (error) {
      log.error("서버 볼륨 읽기 실패(기본 볼륨 사용):", error);
      stored = null;
    }
  }
  return stored ?? config.bot.defaultVolume;
}

/** 볼륨을 바꾸고 멈춘 뒤 부른다(usecases/controls). 다음에 새로 틀 때 이 값으로 시작한다 */
async function saveVolume(guildId: string, level: number) {
  return write(guildId, { volume: level });
}

// ── 볼륨 정규화 ──

/**
 * 이 서버의 볼륨 정규화 켜짐 여부. 재생이 프레임마다(초당 50번) 부르므로 메모리에 담는다.
 * 못 읽으면 끔으로 기억하고 오류 로그를 한 번만 남긴다(다음에 바꾸거나 초기화하면 다시 읽는다). DB 가 열리지 않았으면 끔
 */
function resolveNormalize(guildId: string): boolean {
  const hit = cached(guildId, "normalize");
  if (hit !== undefined) return hit;
  if (!settingsDb.isOpen()) return false;
  let value = false;
  try {
    value = table.getNormalize(guildId);
  } catch (error) {
    log.error("볼륨 정규화 설정 읽기 실패(끔으로 적용):", error);
  }
  remember(guildId, "normalize", value);
  return value;
}

async function setNormalize(guildId: string, on: boolean) {
  return write(guildId, { normalize: on });
}

// ── SponsorBlock 서버별 설정 ──

/** 서버가 정한 그대로의 설정. null 은 전역을 따른다 */
async function getSponsorBlock(guildId: string): Promise<SponsorBlockSetting> {
  const hit = cached(guildId, "sb");
  if (hit !== undefined) return hit;
  try {
    const v = table.getGuildSponsorBlock(guildId);
    remember(guildId, "sb", v);
    return v;
  } catch (error) {
    unlessNotOpen(error);
    log.error("SponsorBlock 설정 읽기 실패(전역 설정 적용):", error);
    return { enabled: null, categories: null };
  }
}

/** 넘긴 하위 키(enabled, categories)만 바꾸고 나머지는 저장된 값을 둔다. 하위 키가 null 이면 전역을 따르게 되돌린다 */
async function setSponsorBlock(guildId: string, patch: Partial<SponsorBlockSetting>) {
  return write(guildId, { sponsorBlock: patch });
}

/**
 * 실제로 쓸 SponsorBlock 설정. 전역 스위치(config)가 꺼져 있으면 서버 설정과 상관없이 끈다(상업적으로 쓸 때의 데이터 라이선스).
 * 켜져 있으면 enabled = 서버 값 ?? true, categories = 서버 값 ?? 전역 기본.
 */
function resolveSponsorBlock(guildId: string): { enabled: boolean; categories: string[] } {
  const master = config.sponsorblock;
  if (!master.enabled) return { enabled: false, categories: [] };
  let per: SponsorBlockSetting;
  try {
    per = table.getGuildSponsorBlock(guildId);
  } catch (error) {
    unlessNotOpen(error);
    log.error("SponsorBlock 설정 읽기 실패(전역 설정 적용):", error);
    per = { enabled: null, categories: null };
  }
  return {
    enabled: per.enabled === null ? true : per.enabled,
    categories: per.categories ?? master.categories,
  };
}

export { table, update, read, onChanged, removeAll, FIELD_LABEL, forgetCache, guildCount, setBotChannel, getBotChannel, clearBotChannel, setDjRoles, getDjRoles, clearDjRoles, playlistAddLimits, getPlaylistAddMax, setPlaylistAddMax, resolvePlaylistAddMax, resolveAgePlace, setAgePlace, resolveVolume, saveVolume, resolveNormalize, setNormalize, getSponsorBlock, setSponsorBlock, resolveSponsorBlock };
export type { SponsorBlockSetting, GuildDoc, GuildField, GuildPatch, Updated };
