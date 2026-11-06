// src/config/ai-models.ts: AI 모델 프로필. base-provider 상속, 본문으로 가는 필드, 레지스트리 카탈로그를 받는 갱신과 형식 검사

import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import * as models from "../../src/config/ai-models.ts";
import { useModelInfo } from "../helpers/model-info.ts";

/** 테스트용 레지스트리 사본(실제 레지스트리에서 테스트가 쓰는 모델만 고른 것) */
const fixture = (): models.Snapshot => JSON.parse(fs.readFileSync(path.join(useModelInfo({ profiles: true }), "ai-models.json"), "utf8"));

// 프로필은 base-provider 를 상속한다. 버텍스 프로필은 schema 가 비어 있고 알맹이가 베이스에 있어,
// 합치지 않으면 추론 필드가 통째로 빈다.
test("base-provider 를 상속해 필드를 합친다", () => {
  const snapshot = {
    baseProviders: {
      p: {
        requestSchema: [
          { key: "topP", type: "number", mapsTo: { target: "body", path: "cfg.topP" } },
          { key: "thinkingLevel", type: "string", enum: [{ value: "low" }], mapsTo: { target: "body", path: "cfg.thinkingConfig.thinkingLevel" } },
        ],
      },
    },
    profiles: { "p:m": { modelId: "m", providerBaseId: "p", schema: [] } },
  };

  const keys = models.fieldsOf("p", "m", snapshot).map((f) => f.key);
  assert.deepEqual(keys, ["topP", "thinkingLevel"]);
  assert.equal(models.fieldsOf("p", "m", snapshot)[1].path, "cfg.thinkingConfig.thinkingLevel");
});

test("본문으로 가는 필드를 프로필이 적힌 순서대로 낸다", () => {
  const snapshot = {
    baseProviders: {
      p: {
        requestSchema: [
          { key: "temperature", mapsTo: { target: "body", path: "cfg.temperature" } },
          { key: "topK", mapsTo: { target: "body", path: "cfg.topK" } },
        ],
      },
    },
    profiles: { "p:m": { modelId: "m", providerBaseId: "p", schema: [] } },
  };

  assert.deepEqual(
    models.fieldsOf("p", "m", snapshot).map((f) => f.key),
    ["temperature", "topK"],
  );
});

test("키가 겹치면 프로필이 이긴다", () => {
  const snapshot = {
    baseProviders: { p: { requestSchema: [{ key: "effort", enum: [{ value: "low" }], mapsTo: { target: "body", path: "effort" } }] } },
    profiles: { "p:m": { modelId: "m", providerBaseId: "p", schema: [{ key: "effort", enum: [{ value: "high" }, { value: "max" }], mapsTo: { target: "body", path: "effort" } }] } },
  };

  const effort = models.fieldsOf("p", "m", snapshot)[0];
  assert.deepEqual(
    effort.enum?.map((e) => e.value),
    ["high", "max"],
  );
});

// 본문으로 안 가는 필드(인증, 쿼리)와 숨긴 필드는 화면에 낼 것이 아니다.
test("본문으로 가는 필드만, 숨긴 것은 빼고", () => {
  const snapshot = {
    baseProviders: { p: { requestSchema: [{ key: "apiKey", mapsTo: { target: "auth", path: "apiKey" } }], uiSchema: { fields: [{ key: "topK", visibility: "hidden" }] } } },
    profiles: {
      "p:m": {
        modelId: "m",
        providerBaseId: "p",
        schema: [
          { key: "topK", mapsTo: { target: "body", path: "topK" } },
          { key: "seed", mapsTo: { target: "body", path: "seed" } },
          { key: "modelId", mapsTo: { target: "body", path: "model" } },
        ],
      },
    },
  };

  const keys = models.fieldsOf("p", "m", snapshot).map((f) => f.key);
  assert.deepEqual(keys, ["seed"], "인증·숨김·modelId 는 뺀다");
});

// 앤트로픽은 max_tokens 가 필수라 프로필의 defaults 에 들어 있다.
test("늘 붙는 값은 base 와 프로필을 겹쳐서 준다", () => {
  const snapshot = {
    baseProviders: { p: { defaultBody: { stream: false, max_tokens: 1024 } } },
    profiles: { "p:m": { modelId: "m", providerBaseId: "p", defaults: { max_tokens: 4096 } } },
  };

  assert.deepEqual(models.defaultsOf("p", "m", snapshot), { stream: false, max_tokens: 4096 });
});

test("모르는 모델은 빈 손으로. 던지지 않는다", () => {
  const snapshot = { baseProviders: {}, profiles: {} };
  assert.deepEqual(models.fieldsOf("p", "없는모델", snapshot), []);
  assert.deepEqual(models.defaultsOf("p", "없는모델", snapshot), {});
  assert.equal(models.profileOf("p", "없는모델", snapshot), null);
});

// 실제 레지스트리의 모양에서 필드를 읽는가. 테스트용 사본은 실제 레지스트리에서 고른 것이다
test("레지스트리 사본에서 현행 모델의 추론 필드를 읽는다", () => {
  const snapshot = fixture();
  assert.ok(Object.keys(snapshot.profiles).length > 10, "프로필이 실려 있다");

  const hasKey = (registry: string, modelId: string, key: string) => models.fieldsOf(registry, modelId, snapshot).some((f) => f.key === key);
  assert.ok(hasKey("anthropic", "claude-opus-5", "effort"), "앤트로픽 5 는 output_config.effort 를 받는다");
  assert.ok(hasKey("vertex-gemini-native", "gemini-3.7-flash", "thinkingLevel"), "버텍스는 베이스에서 상속받는다");
  assert.ok(hasKey("openai", "gpt-6-astra", "reasoning_effort"));

  // 한 세대 차이로 값 집합이 달라진다. Astra 는 none 을 안 받는다
  const astra = models.fieldsOf("openai", "gpt-6-astra", snapshot).find((f) => f.key === "reasoning_effort");
  assert.ok(astra?.enum, "값 목록이 있다");
  assert.ok(!astra.enum.some((e) => e.value === "none"));
});

// 형식 검사를 특정 모델 이름에 묶으면 저쪽이 옛 모델을 뺄 때 멀쩡한 갱신을 거부한다
test("갱신 모양 검사: 모델 이름이 아니라 필드가 통째로 비었는지로 본다", () => {
  const field = { key: "topP", type: "number", mapsTo: { target: "body", path: "top_p" } };
  const snap = (profiles: Record<string, { modelId: string; schema: unknown[] }>) => ({ baseProviders: {}, profiles }) as Parameters<typeof models.lostShape>[1];
  const held = snap({ "a:old": { modelId: "old", schema: [field] }, "b:x": { modelId: "x", schema: [] } });

  assert.deepEqual(models.lostShape(["a", "b"], held, snap({ "a:new": { modelId: "new", schema: [field] } })), [], "옛 모델이 빠지고 새 모델이 와도 된다. 필드가 없던 b 는 보지 않는다");
  assert.deepEqual(models.lostShape(["a", "b"], held, snap({ "a:new": { modelId: "new", schema: [] } })), ["a"], "필드가 있던 a 가 통째로 비면 거부");
  assert.deepEqual(models.lostShape(["a"], snap({}), snap({ "a:new": { modelId: "new", schema: [] } })), ["a"], "가진 버전이 없으면 필드가 하나라도 있어야 한다");
  assert.deepEqual(models.lostShape(["a"], snap({}), snap({ "a:new": { modelId: "new", schema: [field] } })), []);
});

test("갱신 모양 검사: 레지스트리 사본은 스스로와 견줘 통과한다", () => {
  const held = fixture();
  const registries = [...new Set(Object.keys(held.profiles).map((id) => id.split(":")[0]))];
  assert.deepEqual(models.lostShape(registries, held, held), []);
});

// ── 갱신: 목차(index.json)의 해시로 보고 카탈로그(catalog.json) 하나를 받는다 ──

const FIELD = { key: "topP", type: "number", mapsTo: { target: "body", path: "top_p" } };
const catalogOf = (hash: string, more: Record<string, unknown> = {}) => ({
  schemaVersion: 4,
  hash,
  baseProviders: { a: { requestSchema: [FIELD] }, "a-base": { requestSchema: [FIELD] }, other: { requestSchema: [FIELD] } },
  profiles: { "a:m": { modelId: "m", providerBaseId: "a-base", schema: [] }, "z:n": { modelId: "n", providerBaseId: "other", schema: [FIELD] } },
  ...more,
});
/** 레지스트리 흉내. 받은 주소를 남긴다 */
function registry(index: () => unknown, catalog: () => unknown) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const at = String(url).split("/main/")[1] ?? "";
    asked.push(at);
    return new Response(JSON.stringify(at.startsWith("catalog.json") ? catalog() : index()));
  }) as typeof fetch;
  return { asked, fetchImpl };
}

test("갱신: 해시가 바뀌었으면 카탈로그를 받아 우리 레지스트리의 프로필과 그 프로필이 상속하는 베이스만 쓴다", async () => {
  useModelInfo();
  const { asked, fetchImpl } = registry(
    () => ({ schemaVersion: 4, hash: "h1" }),
    () => catalogOf("h1"),
  );
  const got = await models.refresh({ registries: ["a"], fetchImpl });
  assert.deepEqual([got.changed, got.count], [true, 1]);
  assert.deepEqual(asked, ["index.json", "catalog.json?h=h1"], "CDN 의 낡은 사본을 피하려고 해시를 붙여 받는다");
  const held = models.load();
  assert.deepEqual([held.hash, Object.keys(held.profiles), Object.keys(held.baseProviders).sort()], ["h1", ["a:m"], ["a", "a-base"]]);
  assert.equal(models.saved(), true);
  assert.equal(models.fieldsOf("a", "m").length, 1, "베이스에서 필드를 상속한다");
});

test("갱신: 해시가 같으면 카탈로그를 받지 않는다. force 면 받는다", async () => {
  useModelInfo();
  const { asked, fetchImpl } = registry(
    () => ({ schemaVersion: 4, hash: "h1" }),
    () => catalogOf("h1"),
  );
  await models.refresh({ registries: ["a"], fetchImpl });
  asked.length = 0;
  assert.equal((await models.refresh({ registries: ["a"], fetchImpl })).changed, false);
  assert.deepEqual(asked, ["index.json"]);
  await models.refresh({ registries: ["a"], fetchImpl, force: true });
  assert.deepEqual(asked, ["index.json", "index.json", "catalog.json?h=h1"]);
});

test("갱신: 목차와 카탈로그의 해시가 다르거나 형식 버전이 다르면 쓰지 않는다", async () => {
  useModelInfo();
  const stale = registry(
    () => ({ schemaVersion: 4, hash: "h2" }),
    () => catalogOf("h1"),
  );
  await assert.rejects(models.refresh({ registries: ["a"], fetchImpl: stale.fetchImpl }), /해시가 다릅니다/);
  const newer = registry(
    () => ({ schemaVersion: 5, hash: "h3" }),
    () => catalogOf("h3", { schemaVersion: 5 }),
  );
  await assert.rejects(models.refresh({ registries: ["a"], fetchImpl: newer.fetchImpl }), /형식 5/);
  assert.equal(models.saved(), false, "가진 사본을 그대로 둔다");
  assert.deepEqual(models.load().profiles, {}, "받은 것이 없으면 빈 프로필로 돈다");
});

test("갱신: 모양이 틀린 프로필(읽는 쪽이 던질 것, 상속하는 베이스가 없는 것)은 빼고 나머지를 저장한다", async () => {
  useModelInfo();
  const broken = {
    "a:null": null,
    "a:no-model": { schema: [FIELD] },
    "a:lost-base": { modelId: "x", providerBaseId: "missing", schema: [] },
    "a:schema-object": { modelId: "y", schema: { key: "topP" } },
    "a:null-field": { modelId: "z", schema: [null] },
  };
  const { fetchImpl } = registry(
    () => ({ schemaVersion: 4, hash: "h1" }),
    () => {
      const one = catalogOf("h1");
      return { ...one, profiles: { ...one.profiles, ...broken } };
    },
  );
  assert.equal((await models.refresh({ registries: ["a"], fetchImpl })).count, 1);
  assert.deepEqual(Object.keys(models.load().profiles), ["a:m"]);
  assert.deepEqual(models.fieldsOf("a", "x"), [], "뺀 모델은 모르는 모델과 같다");
});

test("갱신: 담을 레지스트리가 바뀌면(프로바이더를 더 지원하게 되면) 해시가 같아도 다시 받는다", async () => {
  useModelInfo();
  const { asked, fetchImpl } = registry(
    () => ({ schemaVersion: 4, hash: "h1" }),
    () => catalogOf("h1"),
  );
  await models.refresh({ registries: ["a"], fetchImpl });
  asked.length = 0;
  const got = await models.refresh({ registries: ["a", "z"], fetchImpl });
  assert.deepEqual(asked, ["index.json", "catalog.json?h=h1"]);
  assert.deepEqual([got.changed, Object.keys(models.load().profiles).sort()], [true, ["a:m", "z:n"]]);
});

test("모델 ID 를 직접 넣어 쓰는 틀(빈 modelId)은 저장하되 모델 목록에는 넣지 않는다", async () => {
  useModelInfo();
  const { fetchImpl } = registry(
    () => ({ schemaVersion: 4, hash: "h1" }),
    () => {
      const one = catalogOf("h1");
      return { ...one, profiles: { ...one.profiles, "a:openai-compatible": { modelId: "", providerBaseId: "a-base", schema: [] } } };
    },
  );
  await models.refresh({ registries: ["a"], fetchImpl });
  assert.deepEqual(Object.keys(models.load().profiles).sort(), ["a:m", "a:openai-compatible"]);
  assert.deepEqual(
    models.modelsOf("a").map((one) => one.modelId),
    ["m"],
  );
});
