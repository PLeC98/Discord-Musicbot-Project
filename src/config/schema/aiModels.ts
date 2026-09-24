// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
/**
 * 모델 프로필. 어느 모델이 어떤 칸을 받고 그 값이 본문 어디로 가는지.
 *
 * PocketRisu 공개 레지스트리를 `data/ai-models.json` 에 원본 그대로 둔다.
 * (CC0-1.0 / https://github.com/PocketRisu/pocketrisu-model-registry)
 */
import fs from "fs";
import path from "path";

const RAW = "https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main";
const FILE = path.join(import.meta.dirname, "..", "..", "..", "data", "ai-models.json");

/**
 * 프로필은 base-provider 를 상속한다. 버텍스 프로필은 `schema: []` 이고 알맹이가 전부
 * 베이스에 있다. 합치지 않으면 추론 칸이 통째로 빈다. 키가 겹치면 프로필이 이긴다.
 */
function mergeSchemas(base, extension) {
  const override = new Set((extension || []).map((f) => f?.key));
  return [...(base || []).filter((f) => !override.has(f?.key)), ...(extension || [])];
}

let held = null;

/** 없으면 빈 것으로 든다. 프로필이 없다고 봇이 멈출 일은 아니다. */
function load({ reload = false } = {}) {
  if (held && !reload) return held;
  try {
    held = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    held = { baseProviders: {}, profiles: {} };
  }
  return held;
}

/** 프로바이더 하나가 아는 모델들. 프로필 id 는 `<registry>:<이름>` 이다. */
function modelsOf(registry, snapshot = load()) {
  const out = [];
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
function profileOf(registry, modelId, snapshot = load()) {
  for (const [id, profile] of Object.entries(snapshot.profiles || {})) {
    if (String(id).split(":")[0] === registry && profile.modelId === modelId) return { id, profile };
  }
  return null;
}

/** 그 모델이 받는 칸들. 본문으로 가는 것만. uiSchema 의 위젯·그룹도 같이 얹는다. */
function fieldsOf(registry, modelId, snapshot = load()) {
  const found = profileOf(registry, modelId, snapshot);
  if (!found) return [];
  const { profile } = found;
  const base = snapshot.baseProviders?.[profile.providerBaseId];
  const hints = new Map([...(base?.uiSchema?.fields || []), ...(profile.uiSchema?.fields || [])].map((f) => [f.key, f]));

  return mergeSchemas(base?.requestSchema, profile.schema)
    .filter((f) => f?.mapsTo?.target === "body" && f.mapsTo.path && f.key !== "modelId")
    .map((f) => {
      const hint = hints.get(f.key) || {};
      const out = { key: f.key, path: f.mapsTo.path, type: f.type, label: f.label };
      if (Array.isArray(f.enum) && f.enum.length) out.enum = f.enum.map((e) => ({ value: e?.value ?? e, label: e?.label ?? String(e?.value ?? e) }));
      for (const n of ["min", "max", "step"]) if (typeof f[n] === "number") out[n] = f[n];
      if (f.default !== undefined) out.default = f.default;
      for (const n of ["widget", "group", "visibility", "showIf", "order"]) if (hint[n] !== undefined) out[n] = hint[n];
      return out;
    })
    .filter((f) => f.visibility !== "hidden")
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** 칸을 담는 묶음. 이름과 차례를 프로필이 정한다. 칸 이름은 영어뿐이고 묶음에만 한국어가 있다. */
function groupsOf(registry, modelId, snapshot = load()) {
  const found = profileOf(registry, modelId, snapshot);
  if (!found) return [];
  const base = snapshot.baseProviders?.[found.profile.providerBaseId];
  const by = new Map();
  for (const g of [...(base?.uiSchema?.groups || []), ...(found.profile.uiSchema?.groups || [])]) {
    by.set(g.id, { id: g.id, label: g.labelI18n?.ko || g.label || g.id, order: g.order ?? 99 });
  }
  return [...by.values()].sort((a, b) => a.order - b.order);
}

/** 늘 붙는 값(base 의 defaultBody + 프로필 defaults). 앤트로픽의 max_tokens 가 여기 있다. */
function defaultsOf(registry, modelId, snapshot = load()) {
  const found = profileOf(registry, modelId, snapshot);
  if (!found) return {};
  const base = snapshot.baseProviders?.[found.profile.providerBaseId];
  return { ...(base?.defaultBody || {}), ...(found.profile.defaults || {}) };
}

/** 저쪽에서 한 판 받아 온다. 원본 그대로 담되 우리 프로바이더 것만 고른다. */
async function fetchRegistry(registries, { timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const get = async (at) => {
    const res = await fetchImpl(`${RAW}/${at}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`레지스트리 ${res.status}: ${at}`);
    return res.json();
  };

  const index = await get("index.json");
  const out = { fetchedAt: new Date().toISOString(), hash: index.hash, baseProviders: {}, profiles: {} };
  for (const one of index.baseProviders || []) {
    if (registries.includes(one.id)) out.baseProviders[one.id] = await get(one.url);
  }
  for (const one of index.profiles || []) {
    if (registries.includes(String(one.id).split(":")[0])) out.profiles[one.id] = await get(one.url);
  }
  return out;
}

// 저쪽이 모양을 바꾸면 칸이 통째로 빈 채로 저장될 수 있다. 아는 모델로 한 번 보고 쓴다.
const CANARY = [
  ["anthropic", "claude-opus-5", "effort"],
  ["vertex-gemini-native", "gemini-3.7-flash", "thinkingLevel"],
  ["openai", "gpt-5.5", "reasoning_effort"],
];

/**
 * 받아서 파일에 쓴다. 해시가 같으면 받지 않는다.
 * 대시보드 갱신 버튼과 `pnpm run update:models` 가 이 길을 같이 쓴다.
 */
async function refresh({ registries, force = false, timeoutMs = 30000 } = {}) {
  const held = load();
  const index = await (await fetch(`${RAW}/index.json`, { signal: AbortSignal.timeout(timeoutMs) })).json();
  if (!force && index.hash && index.hash === held.hash) {
    return { changed: false, count: Object.keys(held.profiles || {}).length, fetchedAt: held.fetchedAt };
  }

  const got = await fetchRegistry(registries, { timeoutMs });
  for (const [registry, modelId, key] of CANARY) {
    if (!fieldsOf(registry, modelId, got).some((one) => one.key === key)) {
      throw new Error(`${modelId} 에 ${key} 가 없습니다. 저쪽 모양이 바뀐 것 같아 쓰지 않았습니다.`);
    }
  }

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(got, null, 2) + String.fromCharCode(10));
  load({ reload: true });
  return { changed: true, count: Object.keys(got.profiles).length, fetchedAt: got.fetchedAt };
}

const exported = { RAW, FILE, CANARY, fetchRegistry, refresh, load, modelsOf, profileOf, fieldsOf, groupsOf, defaultsOf, mergeSchemas };
export default exported;
export { exported as "module.exports" };
