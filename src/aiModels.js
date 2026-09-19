/**
 * 모델 프로필 — 어느 모델이 어떤 칸을 받고 그 값이 본문 어디로 가는지.
 *
 * PocketRisu 공개 레지스트리를 `data/ai-models.json` 에 원본 그대로 둔다.
 * (CC0-1.0 / https://github.com/PocketRisu/pocketrisu-model-registry)
 */
const fs = require("fs");
const path = require("path");

const RAW = "https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main";
const FILE = path.join(__dirname, "..", "data", "ai-models.json");

/**
 * 프로필은 base-provider 를 **상속한다.** 버텍스 프로필은 `schema: []` 이고 알맹이가 전부
 * 베이스에 있다 — 합치지 않으면 추론 칸이 통째로 빈다. 키가 겹치면 프로필이 이긴다.
 */
function mergeSchemas(base, extension) {
  const override = new Set((extension || []).map((f) => f?.key));
  return [...(base || []).filter((f) => !override.has(f?.key)), ...(extension || [])];
}

let held = null;

/** 없으면 빈 것으로 든다 — 프로필이 없다고 봇이 멈출 일은 아니다. */
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

// 우리 설정 화면이 이미 갖고 있는 칸. 두 벌로 뜨면 어느 쪽이 나가는지 알 수 없다.
const OURS = new Set(["temperature"]);

/** 그 모델이 받는 칸들 — 본문으로 가는 것만. uiSchema 의 위젯·그룹도 같이 얹는다. */
function fieldsOf(registry, modelId, snapshot = load()) {
  const found = profileOf(registry, modelId, snapshot);
  if (!found) return [];
  const { profile } = found;
  const base = snapshot.baseProviders?.[profile.providerBaseId];
  const hints = new Map([...(base?.uiSchema?.fields || []), ...(profile.uiSchema?.fields || [])].map((f) => [f.key, f]));

  return mergeSchemas(base?.requestSchema, profile.schema)
    .filter((f) => f?.mapsTo?.target === "body" && f.mapsTo.path && f.key !== "modelId" && !OURS.has(f.key))
    .map((f) => {
      const hint = hints.get(f.key) || {};
      const out = { key: f.key, path: f.mapsTo.path, type: f.type, label: f.label };
      if (Array.isArray(f.enum) && f.enum.length) out.enum = f.enum.map((e) => ({ value: e?.value ?? e, label: e?.label ?? String(e?.value ?? e) }));
      for (const n of ["min", "max", "step"]) if (typeof f[n] === "number") out[n] = f[n];
      if (f.default !== undefined) out.default = f.default;
      for (const n of ["widget", "group", "visibility", "showIf"]) if (hint[n] !== undefined) out[n] = hint[n];
      return out;
    })
    .filter((f) => f.visibility !== "hidden");
}

/** 칸을 담는 묶음 — 이름과 차례를 프로필이 정한다. 칸 이름은 영어뿐이고 묶음에만 한국어가 있다. */
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

module.exports = { RAW, FILE, fetchRegistry, load, modelsOf, profileOf, fieldsOf, groupsOf, defaultsOf, mergeSchemas };
