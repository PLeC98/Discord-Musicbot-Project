import test from "node:test";
import assert from "node:assert";
import * as models from "../../src/config/schema/aiModels.ts";

// 프로필은 base-provider 를 상속한다. 버텍스 프로필은 schema 가 비어 있고 알맹이가 베이스에 있다 —
// 합치지 않으면 추론 칸이 통째로 빈다.
test("base-provider 를 상속해 칸을 합친다", () => {
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

test("본문으로 가는 칸을 프로필이 적힌 차례대로 낸다", () => {
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

// 본문으로 안 가는 칸(인증·쿼리)과 숨긴 칸은 화면에 낼 것이 아니다.
test("본문으로 가는 칸만, 숨긴 것은 빼고", () => {
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

// 실제로 받아 둔 파일이 쓸 만한지. 저쪽 모양이 바뀌면 여기서 걸린다.
test("받아 둔 파일에 현행 모델의 추론 칸이 있다", () => {
  const snapshot = models.load();
  assert.ok(Object.keys(snapshot.profiles).length > 100, "프로필이 실려 있다");

  const hasKey = (registry: string, modelId: string, key: string) => models.fieldsOf(registry, modelId, snapshot).some((f) => f.key === key);
  assert.ok(hasKey("anthropic", "claude-opus-5", "effort"), "앤트로픽 5 는 output_config.effort 를 받는다");
  assert.ok(hasKey("vertex-gemini-native", "gemini-3.7-flash", "thinkingLevel"), "버텍스는 베이스에서 상속받는다");
  assert.ok(hasKey("openai", "gpt-6-astra", "reasoning_effort"));

  // 한 세대 차이로 값 집합이 갈린다 — Astra 는 none 을 안 받는다
  const astra = models.fieldsOf("openai", "gpt-6-astra", snapshot).find((f) => f.key === "reasoning_effort");
  assert.ok(astra?.enum, "값 목록이 있다");
  assert.ok(!astra.enum.some((e) => e.value === "none"));
});
