import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import * as prices from "../../src/config/ai-prices.ts";

const book: prices.PriceBook = { providers: { openai: { "gpt-x": [2, 8, 0.5] }, openrouter: { "free/model:free": [0, 0, 0] } } };

test("키가 없는 로컬은 0, 값표에 있으면 그 값, 없는 모델 · custom 은 가격 모름", () => {
  assert.equal(prices.priceOf("ollama", "qwen3:8b", book), 0);
  assert.deepEqual(prices.priceOf("openai", "gpt-x", book), [2, 8, 0.5]);
  // 값표가 0 인 무료 모델은 0 달러다(가격 모름이 아니다)
  assert.deepEqual(prices.priceOf("openrouter", "free/model:free", book), [0, 0, 0]);
  assert.equal(prices.priceOf("openai", "gpt-unknown", book), null);
  assert.equal(prices.priceOf("custom", "anything", book), null);
  assert.equal(prices.priceOf("nope", "gpt-x", book), null);
});

test("비용: 캐시에서 읽은 입력은 캐시 값, 나머지 입력은 입력 값, 출력은 출력 값", () => {
  // (1000 - 400) * 2 + 400 * 0.5 + 100 * 8 = 1200 + 200 + 800 = 2200 → 100만으로 나눈다
  assert.equal(prices.costOf([2, 8, 0.5], { input: 1000, output: 100, cached: 400, reasoning: 20 }), 0.0022);
  assert.equal(prices.costOf(0, { input: 1000, output: 100, cached: 0, reasoning: 0 }), 0);
  assert.equal(prices.costOf(null, { input: 1000, output: 100, cached: 0, reasoning: 0 }), null);
  // 토큰을 못 읽었으면(실패) 든 값이 없다고 본다
  assert.equal(prices.costOf([2, 8, 0.5], null), 0);
});

test("다운로드한 값표에서 우리 프로바이더 몫의 가격 필드만 선택하고, 입력 · 출력 값이 없는 모델은 뺀다", () => {
  const got = prices.trim(
    {
      openai: { models: { "gpt-x": { cost: { input: 2, output: 8, cache_read: 0.5 } }, "gpt-nocache": { cost: { input: 1, output: 4 } }, "gpt-noprice": {} } },
      "someone-else": { models: { m: { cost: { input: 1, output: 1 } } } },
    },
    "2026-10-11T00:00:00.000Z",
  );
  assert.deepEqual(got.providers, { openai: { "gpt-nocache": [1, 4, 1], "gpt-x": [2, 8, 0.5] } });
  assert.equal(got.fetchedAt, "2026-10-11T00:00:00.000Z");
  assert.ok(got.hash);
});

test("파일 형식은 다시 읽으면 같은 값표다", () => {
  const got = prices.trim({ openai: { models: { "gpt-x": { cost: { input: 2, output: 8 } } } } }, "2026-10-11T00:00:00.000Z");
  assert.deepEqual(JSON.parse(prices.serialize(got)), got);
});

test("다운로드한 때가 새것을 쓴다", () => {
  const old = { fetchedAt: "2026-01-01T00:00:00.000Z", providers: {} };
  const fresh = { fetchedAt: "2026-02-01T00:00:00.000Z", providers: {} };
  assert.equal(prices.newerOf(old, fresh), fresh);
  assert.equal(prices.newerOf(fresh, old), fresh);
  assert.equal(prices.newerOf(null, old), old);
});

test("함께 싣는 기본 사본은 읽히고 가격이 들어 있다", () => {
  const bundled = JSON.parse(fs.readFileSync(prices.BUNDLED, "utf8")) as prices.PriceBook;
  assert.ok(Object.keys(bundled.providers).length > 0);
  for (const models of Object.values(bundled.providers)) for (const price of Object.values(models)) assert.equal(price.length, 3);
});

test("갱신: 저쪽에서 선택한 것이 하나도 없으면 쓰지 않고 던진다", async () => {
  const now = prices.load();
  const empty = async () => new Response(JSON.stringify({}));
  // 빈 값표는 지금 것과 해시가 다르지만 선택한 것이 하나도 없어 쓰지 않는다
  await assert.rejects(prices.refresh({ fetchImpl: empty }), /하나도 읽지 못했습니다/);
  assert.equal(prices.load(), now);
});
