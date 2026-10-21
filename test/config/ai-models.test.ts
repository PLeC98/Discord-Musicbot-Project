import test from "node:test";
import assert from "node:assert";
import * as models from "../../src/config/ai-models.ts";

// 프로필은 base-provider 를 상속한다. 버텍스 프로필은 schema 가 비어 있고 알맹이가 베이스에 있다 —
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

// 본문으로 안 가는 필드(인증·쿼리)와 숨긴 필드는 화면에 낼 것이 아니다.
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

// 앤트로픽은 max_tokens 가 필수다 — 프로필의 defaults 에 들어 있다.
test("늘 붙는 값은 base 와 프로필을 겹쳐서 준다", () => {
  const snapshot = {
    baseProviders: { p: { defaultBody: { stream: false, max_tokens: 1024 } } },
    profiles: { "p:m": { modelId: "m", providerBaseId: "p", defaults: { max_tokens: 4096 } } },
  };

  assert.deepEqual(models.defaultsOf("p", "m", snapshot), { stream: false, max_tokens: 4096 });
});

test("모르는 모델은 빈 손으로 — 던지지 않는다", () => {
  const snapshot = { baseProviders: {}, profiles: {} };
  assert.deepEqual(models.fieldsOf("p", "없는모델", snapshot), []);
  assert.deepEqual(models.defaultsOf("p", "없는모델", snapshot), {});
  assert.equal(models.profileOf("p", "없는모델", snapshot), null);
});

// 실제로 다운로드해 둔 파일이 쓸 만한지. 저쪽 모양이 바뀌면 여기서 걸린다.
test("다운로드해 둔 파일에 현행 모델의 추론 필드가 있다", () => {
  const snapshot = models.load();
  assert.ok(Object.keys(snapshot.profiles).length > 100, "프로필이 실려 있다");

  const hasKey = (registry: string, modelId: string, key: string) => models.fieldsOf(registry, modelId, snapshot).some((f) => f.key === key);
  assert.ok(hasKey("anthropic", "claude-opus-5", "effort"), "앤트로픽 5 는 output_config.effort 를 받는다");
  assert.ok(hasKey("vertex-gemini-native", "gemini-3.7-flash", "thinkingLevel"), "버텍스는 베이스에서 상속받는다");
  assert.ok(hasKey("openai", "gpt-6-astra", "reasoning_effort"));

  // 한 세대 차이로 값 집합이 달라진다 — Astra 는 none 을 안 받는다
  const astra = models.fieldsOf("openai", "gpt-6-astra", snapshot).find((f) => f.key === "reasoning_effort");
  assert.ok(astra?.enum, "값 목록이 있다");
  assert.ok(!astra.enum.some((e) => e.value === "none"));
});

// 모양 검사를 특정 모델 이름에 묶으면 저쪽이 옛 모델을 뺄 때 멀쩡한 갱신을 거부한다
test("갱신 모양 검사: 모델 이름이 아니라 필드가 통째로 비었는지로 본다", () => {
  const field = { key: "topP", type: "number", mapsTo: { target: "body", path: "top_p" } };
  const snap = (profiles: Record<string, { modelId: string; schema: unknown[] }>) => ({ baseProviders: {}, profiles }) as Parameters<typeof models.lostShape>[1];
  const held = snap({ "a:old": { modelId: "old", schema: [field] }, "b:x": { modelId: "x", schema: [] } });

  assert.deepEqual(models.lostShape(["a", "b"], held, snap({ "a:new": { modelId: "new", schema: [field] } })), [], "옛 모델이 빠지고 새 모델이 와도 된다. 필드가 없던 b 는 보지 않는다");
  assert.deepEqual(models.lostShape(["a", "b"], held, snap({ "a:new": { modelId: "new", schema: [] } })), ["a"], "필드가 있던 a 가 통째로 비면 거부");
  assert.deepEqual(models.lostShape(["a"], snap({}), snap({ "a:new": { modelId: "new", schema: [] } })), ["a"], "가진 버전이 없으면 필드가 하나라도 있어야 한다");
  assert.deepEqual(models.lostShape(["a"], snap({}), snap({ "a:new": { modelId: "new", schema: [field] } })), []);
});

test("갱신 모양 검사: 저장소의 버전은 스스로와 견줘 통과한다", () => {
  const held = models.load();
  const registries = [...new Set(Object.keys(held.profiles).map((id) => id.split(":")[0]))];
  assert.deepEqual(models.lostShape(registries, held, held), []);
});

// 다운로드한 사본은 database/ 에 따로 두고(저장소의 기본 사본을 고치지 않는다), 읽을 때는 다운로드한 때가 새것을 쓴다
test("기본 사본 · 다운로드한 사본 중 다운로드한 때가 새것을 쓴다", () => {
  const at = (fetchedAt?: string) => ({ fetchedAt, baseProviders: {}, profiles: {} });
  const bundled = at("2026-10-01T00:00:00.000Z");
  const fetched = at("2026-10-05T00:00:00.000Z");
  assert.equal(models.newerOf(bundled, fetched), fetched);
  assert.equal(models.newerOf(at("2026-10-09T00:00:00.000Z"), fetched)?.fetchedAt, "2026-10-09T00:00:00.000Z", "저장소가 더 새 사본을 내보내면 그것");
  assert.equal(models.newerOf(bundled, null), bundled, "받은 사본이 없으면 기본 사본");
  assert.equal(models.newerOf(null, fetched), fetched);
  assert.equal(models.newerOf(at(), fetched), fetched, "받은 때를 모르면 가장 오래된 것");
  assert.equal(models.newerOf(null, null), null);
  assert.ok(models.FETCHED.includes("database") && models.BUNDLED.includes("data"));
});
