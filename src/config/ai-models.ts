/**
 * 모델 프로필. 어느 모델이 어떤 필드를 받고 그 값이 본문 어디로 가는지.
 *
 * PocketRisu 공개 레지스트리(CC0-1.0 / https://github.com/PocketRisu/pocketrisu-model-registry)의 카탈로그에서 우리 프로바이더 몫을 원본 그대로 받아
 * 실행 위치(`database/ai-models.json`)에 둔다. 저장소에는 싣지 않는다. 받은 것이 없으면 빈 프로필로 돈다(필드를 모르는 모델과 같다).
 * 받는 때는 config/ai-model-info 가 정한다.
 */
import fs from "fs";
import path from "path";
import { PROJECT } from "../infra/project-paths.ts";
import { httpFor } from "../infra/http.ts";
import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import type { ModelField, ModelGroup, ModelSummary, RefreshResult, ShowIf } from "./ai-model-types.ts";
const log = logger.child({ category: "config" });

const RAW = "https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main";
/** 레지스트리 카탈로그의 형식 버전. 다르면 받지 않는다 */
const CATALOG_SCHEMA = 4;
/** 받은 사본 */
let file = path.join(PROJECT.database, "ai-models.json");

// 레지스트리의 모양. 여기서 읽는 필드만
type SchemaField = { key: string; type?: string; label?: string; mapsTo?: { target?: string; path?: string }; enum?: unknown[]; min?: number; max?: number; step?: number; default?: unknown };
type UiField = { key: string; widget?: string; group?: string; visibility?: string; showIf?: ShowIf; order?: number };
type UiGroup = { id: string; label?: string; labelI18n?: { ko?: string }; order?: number };
type UiSchema = { fields?: UiField[]; groups?: UiGroup[] };
type BaseProvider = { requestSchema?: SchemaField[]; uiSchema?: UiSchema; defaultBody?: Record<string, unknown> };
type Profile = {
  modelId: string;
  providerBaseId?: string;
  displayName?: string;
  displayNameI18n?: { ko?: string };
  recommendedTokenizer?: string;
  limits?: { maxOutputTokens?: number; contextWindowTokens?: number };
  capabilities?: string[];
  schema?: SchemaField[];
  uiSchema?: UiSchema;
  defaults?: Record<string, unknown>;
};
/** 파일에 둔 한 버전. hash 는 받은 카탈로그의 해시, registries 는 담은 레지스트리(담을 목록이 바뀌면 해시가 같아도 다시 받는다) */
type Snapshot = { fetchedAt?: string; hash?: string; registries?: string[]; baseProviders: Record<string, BaseProvider>; profiles: Record<string, Profile> };
/** 목차(index.json)에서 읽는 것: 카탈로그 전체의 해시 */
type RegistryIndex = { hash?: unknown };
/** 카탈로그(catalog.json): 레지스트리 전체가 든 파일 하나 */
type Catalog = { schemaVersion?: unknown; hash?: unknown; baseProviders?: Record<string, BaseProvider>; profiles?: Record<string, Profile> };

// 목록의 값 하나. 값만 적거나 { value, label } 로 적는다
function optionOf(e: unknown) {
  const o = e && typeof e === "object" ? (e as { value?: unknown; label?: unknown }) : null;
  const value = o?.value ?? e;
  return { value, label: o?.label != null ? String(o.label) : String(value) };
}

/**
 * 프로필은 base-provider 를 상속한다. 버텍스 프로필은 `schema: []` 이고 알맹이가 전부
 * 베이스에 있다. 합치지 않으면 추론 필드가 통째로 빈다. 키가 겹치면 프로필이 이긴다.
 */
function mergeSchemas(base: SchemaField[] | undefined, extension: SchemaField[] | undefined): SchemaField[] {
  const override = new Set((extension || []).map((f) => f?.key));
  return [...(base || []).filter((f) => !override.has(f?.key)), ...(extension || [])];
}

let held: Snapshot | null = null;

// 받은 사본은 없을 수 있다
function readSnapshot(): Snapshot | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.warn(`AI 모델 정보 읽기 실패(${path.basename(file)}): ${messageOf(error)}`);
    return null;
  }
}

/** 받은 사본. 없으면 빈 것으로 든다. 프로필이 없다고 봇이 멈출 일은 아니다. */
function load({ reload = false } = {}): Snapshot {
  if (held && !reload) return held;
  held = readSnapshot() ?? { baseProviders: {}, profiles: {} };
  return held;
}

/** 받은 사본이 있는가 */
const saved = () => fs.existsSync(file);

/** 받은 사본을 둘 폴더를 바꾼다(테스트). 들고 있던 것은 버린다 */
function _setDir(dir: string) {
  file = path.join(dir, "ai-models.json");
  held = null;
}

/** 프로바이더 하나가 아는 모델들. 프로필 id 는 `<registry>:<이름>` 이다. */
function modelsOf(registry: string, snapshot: Snapshot = load()): ModelSummary[] {
  const out: ModelSummary[] = [];
  for (const [id, profile] of Object.entries(snapshot.profiles || {})) {
    // 모델 ID 를 직접 넣어 쓰는 틀(modelId 가 빈 글, "Enter any model ID")은 모델이 아니다
    if (String(id).split(":")[0] !== registry || !profile.modelId) continue;
    out.push({
      id,
      modelId: profile.modelId,
      name: profile.displayNameI18n?.ko || profile.displayName || profile.modelId,
      tokenizer: profile.recommendedTokenizer || null,
      maxOutputTokens: profile.limits?.maxOutputTokens ?? null,
      contextWindowTokens: profile.limits?.contextWindowTokens ?? null,
      capabilities: profile.capabilities || [],
    });
  }
  return out.sort((a, b) => String(a.modelId).localeCompare(String(b.modelId)));
}

/** 한 프로바이더 안에서 modelId 는 하나다. */
function profileOf(registry: string, modelId: string, snapshot: Snapshot = load()): { id: string; profile: Profile } | null {
  for (const [id, profile] of Object.entries(snapshot.profiles || {})) {
    if (String(id).split(":")[0] === registry && profile.modelId === modelId) return { id, profile };
  }
  return null;
}

// 프로필이 상속하는 베이스
const baseOf = (snapshot: Snapshot, profile: Profile) => (profile.providerBaseId ? snapshot.baseProviders?.[profile.providerBaseId] : undefined);

/** 그 모델이 받는 필드들. 본문으로 가는 것만. uiSchema 의 위젯, 그룹도 같이 얹는다. */
function fieldsOf(registry: string, modelId: string, snapshot: Snapshot = load()): ModelField[] {
  const found = profileOf(registry, modelId, snapshot);
  if (!found) return [];
  const { profile } = found;
  const base = baseOf(snapshot, profile);
  const hints = new Map([...(base?.uiSchema?.fields || []), ...(profile.uiSchema?.fields || [])].map((f) => [f.key, f]));

  return mergeSchemas(base?.requestSchema, profile.schema)
    .flatMap((f) => (f?.mapsTo?.target === "body" && f.mapsTo.path && f.key !== "modelId" ? [{ f, path: f.mapsTo.path }] : []))
    .map(({ f, path }) => {
      const hint: Partial<UiField> = hints.get(f.key) || {};
      const out: ModelField = { key: f.key, path, type: f.type, label: f.label };
      if (Array.isArray(f.enum) && f.enum.length) out.enum = f.enum.map(optionOf);
      for (const n of ["min", "max", "step"] as const) {
        const v = f[n];
        if (typeof v === "number") out[n] = v;
      }
      if (f.default !== undefined) out.default = f.default;
      for (const n of ["widget", "group", "visibility"] as const) {
        const v = hint[n];
        if (v !== undefined) out[n] = v;
      }
      if (hint.showIf !== undefined) out.showIf = hint.showIf;
      if (hint.order !== undefined) out.order = hint.order;
      return out;
    })
    .filter((f) => f.visibility !== "hidden")
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** 필드를 담는 그룹. 이름과 순서를 프로필이 정한다. 필드 이름은 영어뿐이고 그룹에만 한국어가 있다. */
function groupsOf(registry: string, modelId: string, snapshot: Snapshot = load()): ModelGroup[] {
  const found = profileOf(registry, modelId, snapshot);
  if (!found) return [];
  const base = baseOf(snapshot, found.profile);
  const by = new Map<string, ModelGroup>();
  for (const g of [...(base?.uiSchema?.groups || []), ...(found.profile.uiSchema?.groups || [])]) {
    by.set(g.id, { id: g.id, label: g.labelI18n?.ko || g.label || g.id, order: g.order ?? 99 });
  }
  return [...by.values()].sort((a, b) => a.order - b.order);
}

/** 늘 붙는 값(base 의 defaultBody + 프로필 defaults). 앤트로픽의 max_tokens 가 여기 있다. */
function defaultsOf(registry: string, modelId: string, snapshot: Snapshot = load()): Record<string, unknown> {
  const found = profileOf(registry, modelId, snapshot);
  if (!found) return {};
  const base = baseOf(snapshot, found.profile);
  return { ...(base?.defaultBody || {}), ...(found.profile.defaults || {}) };
}

const github = httpFor("github");

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
// 읽는 쪽(fieldsOf, groupsOf, defaultsOf)이 그대로 펼치는 배열. 있으면 배열이고 칸마다 객체여야 한다
const objectList = (value: unknown) => value === undefined || (Array.isArray(value) && value.every(isObject));
const goodUi = (ui: unknown) => ui === undefined || (isObject(ui) && objectList(ui.fields) && objectList(ui.groups));
const goodBase = (base: unknown) => isObject(base) && objectList(base.requestSchema) && goodUi(base.uiSchema);

/**
 * 카탈로그에서 우리 프로바이더의 프로필과 그 프로필이 상속하는 베이스만 선택한다.
 * 모양이 틀린 프로필(읽는 쪽이 던질 것, 상속하는 베이스가 없거나 틀린 것)은 빼고 그 id 를 skipped 로 돌려준다
 */
function pick(catalog: Catalog, registries: string[], fetchedAt = new Date().toISOString()): { snapshot: Snapshot; skipped: string[] } {
  const sources = catalog.baseProviders ?? {};
  const skipped: string[] = [];
  const profiles: Record<string, Profile> = {};
  for (const [id, one] of Object.entries(catalog.profiles ?? {})) {
    if (!registries.includes(String(id).split(":")[0])) continue;
    const ok = isObject(one) && typeof one.modelId === "string" && objectList(one.schema) && goodUi(one.uiSchema) && (one.providerBaseId === undefined || goodBase(sources[one.providerBaseId]));
    if (ok) profiles[id] = one;
    else skipped.push(id);
  }
  const bases = new Set([...registries, ...Object.values(profiles).flatMap((one) => (one.providerBaseId ? [one.providerBaseId] : []))]);
  const baseProviders = Object.fromEntries(Object.entries(sources).filter(([id, base]) => bases.has(id) && goodBase(base)));
  return { snapshot: { fetchedAt, hash: String(catalog.hash), registries: [...registries].sort(), baseProviders, profiles }, skipped };
}

// 저쪽이 모양을 바꾸면 필드가 통째로 빈 채로 저장될 수 있다. 모델 이름이 아니라 모양으로 본다(저쪽이 옛 모델을 빼도 멀쩡하다):
// 지금 가진 버전에서 필드가 있던 레지스트리가 새 버전에서 필드를 통째로 잃으면 쓰지 않는다. 가진 버전이 없으면 필드가 하나라도 있어야 한다
function lostShape(registries: string[], held: Snapshot, got: Snapshot): string[] {
  const fields = (registry: string, snapshot: Snapshot) => modelsOf(registry, snapshot).reduce((n, m) => n + fieldsOf(registry, m.modelId, snapshot).length, 0);
  if (!Object.keys(held.profiles || {}).length) return registries.some((r) => fields(r, got) > 0) ? [] : registries;
  return registries.filter((r) => fields(r, held) > 0 && fields(r, got) === 0);
}

/**
 * 목차의 해시가 받은 사본과 다를 때만 카탈로그를 받아 사본에 쓴다(force 면 해시와 상관없이).
 * 받은 것이 모양 검사(lostShape)에 걸리거나 목차와 해시가 다르면 던지고 가진 사본을 그대로 둔다.
 */
async function refresh({ registries, force = false, timeoutMs = 30000, fetchImpl = github.fetch }: { registries: string[]; force?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<RefreshResult> {
  const get = async <T>(at: string): Promise<T> => {
    const res = await fetchImpl(`${RAW}/${at}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`레지스트리 ${res.status}: ${at}`);
    return (await res.json()) as T;
  };
  const held = load();
  const count = (one: Snapshot) => Object.keys(one.profiles || {}).length;
  const index = await get<RegistryIndex>("index.json");
  if (typeof index.hash !== "string") throw new Error("레지스트리 목차에 해시가 없음");
  const sameRegistries = JSON.stringify(held.registries ?? []) === JSON.stringify([...registries].sort());
  if (!force && count(held) && sameRegistries && index.hash === held.hash) return { changed: false, count: count(held), fetchedAt: held.fetchedAt };

  // raw.githubusercontent.com 은 5분 동안 캐시한다. 해시를 붙여 바뀐 카탈로그를 받고, 목차와 해시가 같은 짝만 쓴다
  const catalog = await get<Catalog>(`catalog.json?h=${encodeURIComponent(index.hash)}`);
  if (catalog.schemaVersion !== CATALOG_SCHEMA) throw new Error(`지원하지 않는 레지스트리 카탈로그 형식: ${String(catalog.schemaVersion)}(${CATALOG_SCHEMA}만 지원)`);
  if (catalog.hash !== index.hash) throw new Error("레지스트리 목차와 카탈로그의 해시가 다름(원격에서 갱신 중, 다음에 다시 불러옴)");
  const { snapshot: got, skipped } = pick(catalog, registries);
  if (skipped.length) log.warn(`AI 모델 정보에서 형식이 맞지 않는 프로필 ${skipped.length}개를 빼고 저장: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? " 등" : ""}`);
  const lost = lostShape(registries, held, got);
  if (lost.length) throw new Error(`${lost.join(", ")} 의 모델 필드가 통째로 비었습니다. 저쪽 모양이 바뀐 것 같아 쓰지 않았습니다.`);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(got, null, 2) + String.fromCharCode(10));
  load({ reload: true });
  return { changed: true, count: count(got), fetchedAt: got.fetchedAt };
}

export { RAW, refresh, load, saved, _setDir, pick, modelsOf, profileOf, fieldsOf, groupsOf, defaultsOf, mergeSchemas, lostShape };
export type { Snapshot, Profile };
