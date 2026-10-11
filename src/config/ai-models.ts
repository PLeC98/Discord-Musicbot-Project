/**
 * 모델 프로필. 어느 모델이 어떤 칸을 받고 그 값이 본문 어디로 가는지.
 *
 * PocketRisu 공개 레지스트리를 원본 그대로 둔다(CC0-1.0 / https://github.com/PocketRisu/pocketrisu-model-registry).
 * 저장소의 `data/ai-models.json` 은 함께 싣는 기본 사본이고, 갱신 단추 · `pnpm run update:models` 가 받은 것은 실행 자리(`database/ai-models.json`)에 쓴다.
 * 기본 사본은 git 이 추적해 고쳐 두면 `git pull` 이 막힌다. 읽을 때는 둘 중 받은 때(`fetchedAt`)가 새것을 쓴다(저장소가 새 사본을 내보내면 그것이 이긴다).
 */
import fs from "fs";
import path from "path";
import { PROJECT } from "../infra/project-paths.ts";
import { httpFor } from "../infra/http.ts";
import type { ModelField, ModelGroup, ModelSummary, RefreshResult, ShowIf } from "./ai-model-types.ts";

const RAW = "https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main";
/** 저장소에 함께 싣는 기본 사본. 여기에는 쓰지 않는다 */
const BUNDLED = path.join(PROJECT.data, "ai-models.json");
/** 받은 사본(실행 자리) */
const FETCHED = path.join(PROJECT.database, "ai-models.json");

// 레지스트리의 모양. 여기서 읽는 칸만
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
/** 파일에 둔 한 버전 */
type Snapshot = { fetchedAt?: string; hash?: string; baseProviders: Record<string, BaseProvider>; profiles: Record<string, Profile> };
/** 목차(index.json). 버전마다 해시와 파일 위치 */
type RegistryIndex = { hash?: string; baseProviders?: Array<{ id: string; url: string }>; profiles?: Array<{ id: string; url: string }> };

// 목록의 값 하나. 값만 적거나 { value, label } 로 적는다
function optionOf(e: unknown) {
  const o = e && typeof e === "object" ? (e as { value?: unknown; label?: unknown }) : null;
  const value = o?.value ?? e;
  return { value, label: o?.label != null ? String(o.label) : String(value) };
}

/**
 * 프로필은 base-provider 를 상속한다. 버텍스 프로필은 `schema: []` 이고 알맹이가 전부
 * 베이스에 있다. 합치지 않으면 추론 칸이 통째로 빈다. 키가 겹치면 프로필이 이긴다.
 */
function mergeSchemas(base: SchemaField[] | undefined, extension: SchemaField[] | undefined): SchemaField[] {
  const override = new Set((extension || []).map((f) => f?.key));
  return [...(base || []).filter((f) => !override.has(f?.key)), ...(extension || [])];
}

let held: Snapshot | null = null;

function readSnapshot(file: string): Snapshot | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

/** 받은 때가 새것. 받은 때를 모르면 가장 오래된 것으로 본다. 같으면 받은 사본(b) */
function newerOf(a: Snapshot | null, b: Snapshot | null): Snapshot | null {
  const at = (one: Snapshot | null) => (one?.fetchedAt ? Date.parse(one.fetchedAt) || 0 : -1);
  if (!a || !b) return a ?? b;
  return at(a) > at(b) ? a : b;
}

/** 기본 사본과 받은 사본 중 새것. 둘 다 없으면 빈 것으로 든다. 프로필이 없다고 봇이 멈출 일은 아니다. */
function load({ reload = false } = {}): Snapshot {
  if (held && !reload) return held;
  held = newerOf(readSnapshot(BUNDLED), readSnapshot(FETCHED)) ?? { baseProviders: {}, profiles: {} };
  return held;
}

/** 프로바이더 하나가 아는 모델들. 프로필 id 는 `<registry>:<이름>` 이다. */
function modelsOf(registry: string, snapshot: Snapshot = load()): ModelSummary[] {
  const out: ModelSummary[] = [];
  for (const [id, profile] of Object.entries(snapshot.profiles || {})) {
    if (String(id).split(":")[0] !== registry) continue;
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

/** 그 모델이 받는 칸들. 본문으로 가는 것만. uiSchema 의 위젯·그룹도 같이 얹는다. */
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

/** 칸을 담는 묶음. 이름과 차례를 프로필이 정한다. 칸 이름은 영어뿐이고 묶음에만 한국어가 있다. */
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

/** 저쪽에서 한 버전 받아 온다. 원본 그대로 담되 우리 프로바이더 것만 고른다. */
// index: 이미 받아 둔 목차(갱신은 해시를 보려고 먼저 받는다). 없으면 여기서 받는다
// 모델 목록은 GitHub 에서 받는다(공유 HTTP 클라이언트)
const github = httpFor("github");

async function fetchRegistry(registries: string[], { timeoutMs = 30000, fetchImpl = github.fetch, index: known }: { timeoutMs?: number; fetchImpl?: typeof fetch; index?: RegistryIndex } = {}): Promise<Snapshot> {
  const get = async <T>(at: string): Promise<T> => {
    const res = await fetchImpl(`${RAW}/${at}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`레지스트리 ${res.status}: ${at}`);
    return (await res.json()) as T;
  };

  const index = known ?? (await get<RegistryIndex>("index.json"));
  const out: Snapshot = { fetchedAt: new Date().toISOString(), hash: index.hash, baseProviders: {}, profiles: {} };
  for (const one of index.baseProviders || []) {
    if (registries.includes(one.id)) out.baseProviders[one.id] = await get<BaseProvider>(one.url);
  }
  for (const one of index.profiles || []) {
    if (registries.includes(String(one.id).split(":")[0])) out.profiles[one.id] = await get<Profile>(one.url);
  }
  return out;
}

// 저쪽이 모양을 바꾸면 칸이 통째로 빈 채로 저장될 수 있다. 모델 이름이 아니라 모양으로 본다(저쪽이 옛 모델을 빼도 멀쩡하다):
// 지금 가진 버전에서 칸이 있던 레지스트리가 새 버전에서 칸을 통째로 잃으면 쓰지 않는다. 가진 버전이 없으면 칸이 하나라도 있어야 한다
function lostShape(registries: string[], held: Snapshot, got: Snapshot): string[] {
  const fields = (registry: string, snapshot: Snapshot) => modelsOf(registry, snapshot).reduce((n, m) => n + fieldsOf(registry, m.modelId, snapshot).length, 0);
  if (!Object.keys(held.profiles || {}).length) return registries.some((r) => fields(r, got) > 0) ? [] : registries;
  return registries.filter((r) => fields(r, held) > 0 && fields(r, got) === 0);
}

/**
 * 받아서 받은 사본(`database/ai-models.json`)에 쓴다. 해시가 같으면 받지 않는다.
 * 대시보드 갱신 버튼과 `pnpm run update:models` 가 이 길을 같이 쓴다.
 */
async function refresh({ registries, force = false, timeoutMs = 30000 }: { registries: string[]; force?: boolean; timeoutMs?: number }): Promise<RefreshResult> {
  const held = load();
  const index = (await (await github.fetch(`${RAW}/index.json`, { signal: AbortSignal.timeout(timeoutMs) })).json()) as RegistryIndex;
  if (!force && index.hash && index.hash === held.hash) {
    return { changed: false, count: Object.keys(held.profiles || {}).length, fetchedAt: held.fetchedAt };
  }

  const got = await fetchRegistry(registries, { timeoutMs, index });
  const lost = lostShape(registries, held, got);
  if (lost.length) throw new Error(`${lost.join(" · ")} 의 모델 칸이 통째로 비었습니다. 저쪽 모양이 바뀐 것 같아 쓰지 않았습니다.`);

  fs.mkdirSync(path.dirname(FETCHED), { recursive: true });
  fs.writeFileSync(FETCHED, JSON.stringify(got, null, 2) + String.fromCharCode(10));
  load({ reload: true });
  return { changed: true, count: Object.keys(got.profiles).length, fetchedAt: got.fetchedAt };
}

export { RAW, BUNDLED, FETCHED, fetchRegistry, refresh, load, newerOf, modelsOf, profileOf, fieldsOf, groupsOf, defaultsOf, mergeSchemas, lostShape };
export type { Snapshot, Profile };
